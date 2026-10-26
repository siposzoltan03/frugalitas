/** @jsxImportSource @opentui/solid */
// Frugalitas inside opencode. Reuses the host-neutral modules in ../hooks (litellm, format, advice, packs, mode).
import { createSignal } from 'solid-js'
import type { TuiPlugin, TuiPluginModule } from '@opencode-ai/plugin/tui'

import {
  cacheCountdownDone,
  cacheSoonWarning,
  cacheStatus,
  cacheTtlMs,
  clearOrRewriteTip,
  restartCosts,
  restartWorthIt,
  CONDENSE_RATIO,
  pickSummaryModel,
  restartViaSummaryCost,
  handoverMarkdown,
  MIN_CONTEXT_TOKENS,
  parallelUseTip,
  handoverTitle,
  resumePrompt,
} from '../hooks/advice'
import type { Handover } from '../hooks/advice'
import { addDays, inKind, money, ratios, SCOPE_NAMES, statusLine, utcDate } from '../hooks/format'
import type { Budgets, Scope, Spend } from '../hooks/format'
import { fetchActivity, fetchKeySpend, fetchPrices, priceFor } from '../hooks/litellm'
import type { Day, Prices } from '../hooks/litellm'
import { asMode, mode, setMode, tr } from '../hooks/mode'
import { fill, packById, pickLine, voice } from '../hooks/packs'
import { homedir } from 'node:os'
import { balance, buy, earned, owns, progressBar, rankOf, wear, worn } from '../hooks/xp'
import type { Ledger } from '../hooks/xp'
import { creditDays, findClaudeStores, importLedger, loadLedger, saveLedger, shopItems, shopRow, xpText } from './ledger'
import { listHandovers, rowsOf, writeHandover } from './restart'
import { mascotMood } from '../hooks/mascot'
import { Mascot } from './mascot'
import { skinById } from '../hooks/skins'
import { worst } from '../hooks/format'
import { adviceFrom, reportText, tipsText } from './report'
import type { Advice } from './report'
import { allowToday, connFromConfig, fetchLite, loadOptions, numOption, PROVIDER, readBlocked, saveOption, trace } from './shared'

const POLL_MS = 5 * 60_000

/** Per-session bookkeeping; the Claude Code plugin keeps the same things in plain variables. */
type Sess = {
  cost: number
  /** Session cost when the last turn ended, so a turn's cost is the difference. */
  turnBase: number
  /** When the prompt cache's lifetime started: the start of the turn's last request. */
  warmSince: number
  ctx: number
  baseCtx: number
  model: string
  soonFor: number
  expiredFor: number
}

const tui: TuiPlugin = async (api, entryOptions) => {
  try {
    await run(api, entryOptions)
  } catch (e: any) {
    trace(`tui plugin failed: ${e?.stack ?? e}`)
    throw e
  }
}

const run = async (api: Parameters<TuiPlugin>[0], entryOptions: Parameters<TuiPlugin>[1]) => {
  const options = loadOptions(entryOptions)
  const conn = connFromConfig(api.state.config)
  if (!conn) return trace(`no litellm connection: providers in config = ${Object.keys((api.state.config as any)?.provider ?? {}).join(',') || 'none'}`) // not a LiteLLM setup: stay silent, like the Claude Code plugin

  const num = (key: string, fallback: number) => numOption(options, key, fallback)
  const budgets: Budgets = { session: num('sessionBudget', 20), daily: num('dailyBudget', 60), monthly: num('monthlyBudget', 800) }
  const expensiveTurn = num('expensiveTurn', 1)
  // Below this many tokens of context a cache rewrite is too cheap to advise about.
  const minContext = num('adviceMinContext', MIN_CONTEXT_TOKENS)
  const hufRate = num('hufRate', 350)
  const isFun = options.fun !== false
  // The sidebar mascot: 'small' (12×11 cells, default), 'large' (24×22) or 'off'.
  // The card behind it: a color (`#rrggbb`), or 'none' for the sidebar's own background.
  const mascotBackdrop = options.mascotBackdrop === 'none' ? undefined : typeof options.mascotBackdrop === 'string' ? options.mascotBackdrop : '#59606e'
  const mascotScale: 1 | 2 | 0 = options.mascot === 'off' || !isFun ? 0 : options.mascot === 'large' ? 1 : 2
  setMode(asMode(options.mode) ?? 'frugalitas')
  const cacheTtl = cacheTtlMs(options.promptCacheTtl ?? process.env.CLAUDE_CODE_PROMPT_CACHE_TTL)
  const [ledger, setLedger] = createSignal<Ledger>(loadLedger(utcDate(Date.now())))
  const pack = () => packById(worn(ledger()).pack)
  const say = (lines: readonly string[], vars: Record<string, string | number>, seed: number) => fill(pickLine(lines, seed), vars)

  let prices: Record<string, Prices> = {}
  const priceOf = (model: string) => priceFor(prices, model)
  const [today, setToday] = createSignal<number | undefined>()
  const [month, setMonth] = createSignal<number | undefined>()
  const [date, setDate] = createSignal(utcDate(Date.now()))
  const [err, setErr] = createSignal<string | undefined>()
  const [advice, setAdvice] = createSignal<Advice | undefined>()
  let keyBase: number | undefined // the key's lifetime spend when this opencode started, for the parallel-use tip
  let keyNow = 0
  let history: Day[] | undefined // ~8 weeks, fetched once a day for the weekday tip
  let historyOn = ''
  const [now, setNow] = createSignal(Date.now())
  // The texts read the mode through tr(); this signal makes the status line and sidebar redraw when it changes.
  const [modeSeen, setModeSeen] = createSignal(mode())
  const [sessions, setSessions] = createSignal<Record<string, Sess>>({})
  const sess = (id: string): Sess =>
    (sessions()[id] ??= { cost: 0, turnBase: 0, warmSince: 0, ctx: 0, baseCtx: 0, model: '', soonFor: 0, expiredFor: 0 })
  const touch = () => setSessions({ ...sessions() })

  const spendOf = (sid: string): Spend => ({ session: sessions()[sid]?.cost ?? 0, today: today() ?? 0, month: month() ?? 0 })

  const periodOf = (scope: Scope, sid: string) => (scope === 'session' ? sid : scope === 'daily' ? date() : date().slice(0, 7))

  /** A toast at 80% and again at 100% of each budget, once per period (remembered in kv). */
  function checkBudgets(sid: string) {
    if (today() === undefined) return
    const spend = spendOf(sid)
    const spentBy: Record<Scope, number> = { session: spend.session, daily: spend.today, monthly: spend.month }
    for (const [scope, ratio] of Object.entries(ratios(spend, budgets)) as [Scope, number][]) {
      const level = ratio >= 1 ? 2 : ratio >= 0.8 ? 1 : 0
      if (level === 0) continue
      const key = `frugalitas.warned:${scope}:${periodOf(scope, sid)}`
      if (level <= api.kv.get<number>(key, 0)) continue
      api.kv.set(key, level)
      if (level === 1) {
        const vars = { scope: SCOPE_NAMES[scope], pct: Math.round(ratio * 100) }
        const message = isFun ? say(pack().warn, vars, now()) : tr(`frugal: ${vars.scope} budget at ${vars.pct}%`, `fukarléc: ${vars.scope} keret ${vars.pct}%`)
        api.ui.toast({ title: 'Frugalitas', message, variant: 'warning', duration: 8000 })
      } else {
        const spent = spentBy[scope]
        const message = isFun
          ? say(pack().over, { scope: SCOPE_NAMES[scope], spent: money(spent), budget: money(budgets[scope]), kind: inKind(spent, hufRate) }, now())
          : tr(`frugal: ${SCOPE_NAMES[scope]} budget exceeded (${money(spent)}/${money(budgets[scope])})`, `fukarléc: ${SCOPE_NAMES[scope]} keret túllépve (${money(spent)}/${money(budgets[scope])})`)
        api.ui.toast({ title: 'Frugalitas', message, variant: 'error', duration: 12_000 })
        void api.attention.notify({ title: 'Frugalitas', message })
      }
    }
  }

  /** Once per UTC day: pay out the closed days since the last credit, and say so. */
  let creditedOn = ''
  const creditToday = async (d: string) => {
    if (creditedOn === d) return
    creditedOn = d
    try {
      const r = await creditDays(conn, ledger(), d, budgets.daily)
      if (r.gained === 0) return
      saveLedger(r.ledger)
      setLedger(r.ledger)
      const quests = r.quests > 0 ? tr(` 🎯 (${r.quests} quest${r.quests > 1 ? 's' : ''})`, ` 🎯 (${r.quests} küldetés)`) : ''
      const message = (isFun ? say(pack().xp, { xp: r.gained }, Date.now()) : tr(`frugal: +${r.gained} coins`, `fukarléc: +${r.gained} XP`)) + quests
      api.ui.toast({ title: 'Frugalitas', message, variant: 'success', duration: 10_000 })
    } catch (e: any) {
      creditedOn = '' // try again at the next refresh
      trace(`credit failed: ${e?.message ?? e}`)
    }
  }

  /** What this opencode priced live (not history), against what the key spent meanwhile: the rest was someone else. */
  const liveCost = new Map<string, number>()
  const parallelTip = () => parallelUseTip([...liveCost.values()].reduce((n, c) => n + c, 0), Math.max(0, keyNow - (keyBase ?? keyNow)))

  const refresh = async () => {
    try {
      const t = Date.now()
      const d = utcDate(t)
      const a = await fetchActivity(fetchLite, conn, `${d.slice(0, 7)}-01`, d)
      setDate(d)
      setMonth(a.total.spend)
      setToday(a.days.find(x => x.date === d)?.metrics.spend ?? 0)
      setErr(undefined)
      if (historyOn !== d) {
        history = (await fetchActivity(fetchLite, conn, addDays(d, -56), d).catch(() => undefined))?.days
        historyOn = d
      }
      keyNow = await fetchKeySpend(fetchLite, conn).catch(() => keyNow)
      keyBase ??= keyNow
      setAdvice(adviceFrom({ month: a, history, date: d, budgets, priceOf, fun: isFun, pack: pack(), extra: [parallelTip()] }))
      for (const sid of Object.keys(sessions())) checkBudgets(sid)
      void creditToday(d)
    } catch (e: any) {
      setErr(String(e?.message ?? e).slice(0, 60))
    }
  }
  try {
    prices = await fetchPrices(fetchLite, conn)
  } catch (e: any) {
    setErr(String(e?.message ?? e).slice(0, 60))
  }
  void refresh()

  // Session spend: each assistant message priced token by token (opencode's own `cost` is 0 for custom providers).
  // A subagent's messages count toward the session it was started from, as in the Claude Code plugin.
  const priced = new Map<string, { sid: string; cost: number }>() // messages update repeatedly while streaming
  const rootOf = (id: string): string => {
    for (let i = 0; i < 8; i++) {
      const parent = api.state.session.get(id)?.parentID
      if (!parent) break
      id = parent
    }
    return id
  }
  /** Prices one assistant message into its root session; false when it isn't ours or has no price. */
  const account = (m: any, live = false): boolean => {
    if (m.role !== 'assistant' || m.providerID !== PROVIDER) return false
    const p = priceOf(m.modelID)
    if (!p) return false
    const t = m.tokens
    const root = rootOf(m.sessionID)
    const cost = t.input * p.input + t.output * p.output + t.cache.read * p.cacheRead + t.cache.write * p.cacheWrite
    priced.set(m.id, { sid: root, cost })
    if (live) liveCost.set(m.id, cost)
    const s = sess(root)
    s.cost = 0
    for (const v of priced.values()) if (v.sid === root) s.cost += v.cost
    if (m.time.completed && m.sessionID === root) {
      s.model = m.modelID
      s.ctx = t.input + t.cache.read + t.cache.write
      if (s.baseCtx === 0) s.baseCtx = s.ctx
      if (m.time.created >= s.warmSince) s.warmSince = m.time.created
    }
    return true
  }
  const off = api.event.on('message.updated', ev => {
    const m = ev.properties.info
    if (!account(m, true)) return
    if (m.role === 'assistant' && m.time.completed) void refresh()
    touch()
    checkBudgets(rootOf(m.sessionID))
  })

  /**
   * A session opened before the plugin started (or resumed) has history the events never told us about. The TUI
   * loads a session's messages a moment after it opens, so this retries (once a second, from the timer) until
   * there are some.
   */
  const backfilled = new Set<string>()
  const wanted = new Map<string, number>() // session -> attempts so far
  const backfill = async (sid: string) => {
    if (backfilled.has(sid)) return
    wanted.set(sid, (wanted.get(sid) ?? 0) + 1)
    try {
      const children = ((await api.client.session.children({ sessionID: sid })).data ?? []).map(c => c.id)
      let seen = 0
      let counted = 0
      const skipped = new Set<string>()
      for (const id of [sid, ...children]) {
        const loaded = api.state.session.messages(id)
        const list = loaded.length > 0 ? loaded : ((await api.client.session.messages({ sessionID: id, limit: 10_000 })).data ?? []).map(x => x.info)
        for (const info of list) {
          seen++
          if (account(info)) counted++
          else if ((info as any).role === 'assistant') skipped.add(`${(info as any).providerID}/${(info as any).modelID}`)
        }
      }
      if (seen === 0) return // not loaded yet: the timer tries again
      backfilled.add(sid)
      wanted.delete(sid)
      const s = sess(sid)
      s.turnBase = s.cost // history is not a turn: no expensive-turn toast for it
      touch()
      checkBudgets(sid)
    } catch (e: any) {
      trace(`backfill failed: ${e?.message ?? e}`)
    }
  }

  // A turn ends at session.idle: toast if it was expensive.
  const offIdle = api.event.on('session.idle', ev => {
    const s = sess(rootOf(ev.properties.sessionID))
    const cost = s.cost - s.turnBase
    s.turnBase = s.cost
    if (expensiveTurn > 0 && cost >= expensiveTurn) {
      const message = isFun ? say(pack().turn, { cost: money(cost), kind: inKind(cost, hufRate) }, now()) : tr(`Expensive turn: +${money(cost)}`, `Drága kör: +${money(cost)}`)
      api.ui.toast({ title: 'Frugalitas', message, variant: 'warning', duration: 8000 })
    }
    touch()
  })

  const busy = (sid: string) => api.state.session.status(sid)?.type === 'busy'

  /** What a restart would cost for the next turns, estimated before the transcript is read. */
  const estimateRestart = (ctx: number, baseCtx: number, model: string): number | undefined => {
    const condensed = Math.round(ctx * CONDENSE_RATIO)
    const small = pickSummaryModel(prices, condensed)
    const main = priceOf(model)
    return small && main ? restartViaSummaryCost(condensed, baseCtx, small.price, main) : undefined
  }

  /** The advice texts name Claude Code's commands; opencode's are different. */
  const localize = (text: string) =>
    text.replace(/\/(?:frugal|fukarlec) restart/g, tr('/frugal → Restart', '/frugal → Újrakezdés')).replace(/\/clear\b/g, '/new')

  /** The keep / compact / restart / clear comparison for a session whose cache has expired. */
  const expiredTip = (s: Sess): string | undefined =>
    clearOrRewriteTip(s.ctx, s.baseCtx, priceOf(s.model), estimateRestart(s.ctx, s.baseCtx, s.model), minContext)

  /** Once a second: move the countdown, warn ~30 s before a big context's cache expires, advise at expiry. */
  let blockedSeen = Date.now()
  const timer = setInterval(() => {
    const t = Date.now()
    setNow(t)
    for (const [sid, attempts] of wanted) {
      if (attempts >= 30) wanted.delete(sid)
      else void backfill(sid)
    }
    const blocked = readBlocked()
    if (blocked && blocked.at > blockedSeen) {
      blockedSeen = blocked.at
      api.ui.toast({ title: '🔒 Frugalitas', message: blocked.message, variant: 'error', duration: 15_000 })
    }
    for (const [sid, s] of Object.entries(sessions())) {
      if (s.warmSince === 0 || busy(sid)) continue
      const remaining = s.warmSince + cacheTtl - t
      if (s.soonFor !== s.warmSince) {
        const warning = cacheSoonWarning(remaining, s.ctx, priceOf(s.model), minContext)
        if (warning) {
          s.soonFor = s.warmSince
          const message = localize(isFun ? voice(warning, pack(), t) : warning)
          api.ui.toast({ title: 'Frugalitas', message, variant: 'warning', duration: 20_000 })
          if (s.ctx * (priceOf(s.model)?.cacheWrite ?? 0) >= 0.5) void api.attention.notify({ title: 'Frugalitas', message: warning })
        }
      }
      if (remaining <= 0 && s.expiredFor !== s.warmSince) {
        s.expiredFor = s.warmSince
        const tip = expiredTip(s)
        if (tip) api.ui.toast({ title: 'Frugalitas', message: localize(isFun ? voice(tip, pack(), t) : tip), variant: 'info', duration: 20_000 })
      }
    }
  }, 1000)
  const poll = setInterval(refresh, POLL_MS)
  api.lifecycle.onDispose(() => {
    clearInterval(timer)
    clearInterval(poll)
    off()
    offIdle()
  })

  const cacheSuffix = (sid: string) => {
    const s = sessions()[sid]
    if (!s || s.warmSince === 0 || busy(sid)) return ''
    const remaining = s.warmSince + cacheTtl - now()
    return cacheCountdownDone(remaining, s.expiredFor === s.warmSince) ? ` · ${cacheStatus(0)}` : ` · ${cacheStatus(remaining)}`
  }

  const line = (sid: string) =>
    (modeSeen(), err()) && today() === undefined
      ? `🪙 ⚠︎ ${err()}`
      : statusLine(spendOf(sid), budgets, isFun, err() !== undefined) + cacheSuffix(sid)

  /** `/frugal`: pick what to see; slash commands take no arguments, so the old `/frugal 7` is a menu entry. */
  const show = async (title: string, text: () => Promise<string>) => {
    api.ui.dialog.setSize('xlarge')
    api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message: tr('Loading…', 'Betöltés…') }))
    let message: string
    try {
      message = await text()
    } catch (e: any) {
      message = `⚠︎ ${String(e?.message ?? e)}`
    }
    api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message, onConfirm: () => api.ui.dialog.clear() }))
  }
  const common = (sid?: string) => ({ conn, budgets, spend: spendOf(sid ?? ''), fun: isFun, hufRate })
  /** Mascot skins and message packs for coins; picking one buys it (when owned: wears it). */
  const shop = (note?: string) => {
    const l = ledger()
    api.ui.dialog.setSize('large')
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: tr(`🛒 Shop · ${balance(l)} coins${note ? ` · ${note}` : ''}`, `🛒 Bolt · ${balance(l)} garas${note ? ` · ${note}` : ''}`),
        options: shopItems().map(i => ({ ...shopRow(l, i), value: `${i.kind}:${i.id}` })),
        onSelect: o => {
          const item = shopItems().find(i => `${i.kind}:${i.id}` === o.value)!
          const result = owns(l, item) ? wear(l, item) : buy(l, item)
          if ('error' in result) return shop(result.error)
          saveLedger(result.ledger)
          setLedger(result.ledger)
          shop(owns(l, item) ? tr(`now using ${item.name}`, `felvéve: ${item.name}`) : tr(`bought ${item.name}`, `megvetted: ${item.name}`))
        },
      }),
    )
  }
  /** Start a fresh session whose prompt is pre-filled with the handover; Enter sends it. */
  const continueFrom = async (h: Handover) => {
    const res = await api.client.session.create({ title: `🧳 ${handoverTitle(h.text) || h.id}` })
    const id = res.data?.id
    if (!id) throw new Error('could not create a session')
    api.route.navigate('session', { sessionID: id, prompt: { input: resumePrompt(h.id, h.text), parts: [] } })
  }

  /** `/frugal restart`: a small model writes the handover, then a new session starts from it. */
  const restart = async (sonnetOnly: boolean, sid: string | undefined) => {
    api.ui.dialog.setSize('medium')
    const title = tr('🧳 Restart from a handover', '🧳 Újrakezdés átadással')
    if (!sid) return void api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message: tr('Open a session first: there is no conversation to hand over.', 'Előbb nyiss egy sessiont: nincs mit átadni.'), onConfirm: () => api.ui.dialog.clear() }))
    api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message: tr('Reading the conversation and writing the handover…', 'Beszélgetés olvasása, átadás írása…') }))
    try {
      // What the TUI has loaded for the open session (messages and their parts); the history call is the fallback.
      const loaded = api.state.session.messages(sid).map(info => ({ info, parts: api.state.part(info.id) }))
      const msgs = loaded.length > 0 ? loaded : ((await api.client.session.messages({ sessionID: sid, limit: 10_000 })).data ?? [])
      const rows = rowsOf(msgs)
      if (rows.length === 0) throw new Error(tr('there is no conversation to hand over yet', 'még nincs mit átadni'))
      const w = await writeHandover({ conn, prices, rows, cwd: api.state.path.directory, sonnetOnly })
      if ('error' in w) throw new Error(w.error)
      await continueFrom(w.handover)
      api.ui.dialog.clear()
      api.ui.toast({ title: 'Frugalitas', message: tr(`🧳 Handover ${w.handover.id} by ${w.handover.model} (~${money(w.cost)}), saved to ${w.handover.path}. Press Enter to continue from it.`, `🧳 A(z) ${w.handover.id} átadást a ${w.handover.model} írta (~${money(w.cost)}), mentve: ${w.handover.path}. Enter: folytatás.`), variant: 'success', duration: 15_000 })
    } catch (e: any) {
      api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message: tr(`The handover could not be written (${String(e?.message ?? e)}); nothing was changed.`, `Nem sikerült az átadás (${String(e?.message ?? e)}); nem változtattam semmit.`), onConfirm: () => api.ui.dialog.clear() }))
    }
  }

  /** The saved handovers: pick one to read it, then continue from it. */
  const handovers = () => {
    const all = listHandovers().slice(0, 30)
    api.ui.dialog.setSize('large')
    if (all.length === 0) return void api.ui.dialog.replace(() => api.ui.DialogAlert({ title: '🧳 Handovers', message: tr('No handovers yet. "Restart from a handover" writes one.', 'Még nincs átadás. Az "Újrakezdés átadással" ír egyet.'), onConfirm: () => api.ui.dialog.clear() }))
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: tr('🧳 Handovers (newest first)', '🧳 Átadások (a legújabbak elöl)'),
        options: all.map(h => ({ title: handoverTitle(h.text) || h.id, description: `${new Date(h.at).toISOString().replace('T', ' ').slice(0, 16)} · ${h.model.replace(/^.*\//, '')} · ${h.id}`, value: h.id })),
        onSelect: o => {
          const h = all.find(x => x.id === o.value)!
          api.ui.dialog.setSize('xlarge')
          api.ui.dialog.replace(() =>
            api.ui.DialogConfirm({
              title: `🧳 ${h.id}`,
              message: `${h.path ? `${h.path}\n\n` : ''}${handoverMarkdown(h)}\n${tr('Enter: continue from it in a new session · Esc: close', 'Enter: folytatás új sessionben · Esc: bezár')}`,
              onConfirm: () => void continueFrom(h).then(() => api.ui.dialog.clear()).catch(e => api.ui.toast({ title: 'Frugalitas', message: String(e?.message ?? e), variant: 'error' })),
              onCancel: () => api.ui.dialog.clear(),
            }),
          )
        },
      }),
    )
  }

  /** Frugalitas (English, USD) <-> Fukarléc (Hungarian, HUF), remembered in frugalitas.json. */
  const switchMode = () => {
    const next = mode() === 'frugalitas' ? 'fukarlec' : 'frugalitas'
    setMode(next)
    setModeSeen(next)
    try {
      saveOption('mode', next)
    } catch (e: any) {
      trace(`could not save the mode: ${e?.message ?? e}`)
    }
    api.ui.dialog.clear()
    void refresh() // the advice texts are built in the mode's language
    api.ui.toast({ title: 'Frugalitas', message: next === 'fukarlec' ? '🇭🇺 Fukarléc mód: magyarul beszélünk, Fukar bácsi a boltos.' : '🇬🇧 Frugalitas mode: English, Old Penny keeps the shop.', variant: 'info' })
  }

  /** The open session's id, if a session is on screen. */
  const currentSession = (): string | undefined => (api.route.current.name === 'session' ? String((api.route.current as any).params?.sessionID ?? '') || undefined : undefined)

  /** Advice that needs this session or this process: the cache-expired comparison and the parallel-use tip. */
  const tipExtras = (sid: string | undefined): (string | undefined)[] => {
    const s = sid ? sessions()[sid] : undefined
    const expired = s && s.warmSince > 0 && !busy(sid!) && now() > s.warmSince + cacheTtl
    return [expired ? expiredTip(s) : undefined, parallelTip()].map(x => x && localize(x))
  }

  /** Fold the Claude Code plugin's coins and purchases into this ledger (safe to repeat). */
  const importCoins = () => {
    const stores = findClaudeStores(date())
    api.ui.dialog.setSize('large')
    if (stores.length === 0) return void api.ui.dialog.replace(() => api.ui.DialogAlert({ title: tr('Import from Claude Code', 'Import a Claude Code-ból'), message: tr('No Frugalitas ledger found under ~/.claude/plugins/store or ~/.claude-personal/plugins/store.', 'Nincs Frugalitas főkönyv a ~/.claude/plugins/store vagy ~/.claude-personal/plugins/store alatt.'), onConfirm: () => api.ui.dialog.clear() }))
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: tr('Import coins from Claude Code', 'Garas importálása a Claude Code-ból'),
        options: stores.map((s, i) => ({ title: `${earned(s.ledger)} ${tr('coins earned', 'garas szerezve')} · ${rankOf(earned(s.ledger)).name}`, description: s.file.replace(homedir(), '~'), value: i })),
        onSelect: o => {
          const merged = importLedger(ledger(), stores[o.value as number]!.ledger)
          saveLedger(merged)
          setLedger(merged)
          api.ui.dialog.clear()
          api.ui.toast({ title: 'Frugalitas', message: tr(`Imported: ${earned(merged)} coins earned, ${balance(merged)} in your pocket.`, `Importálva: ${earned(merged)} garas szerezve, ${balance(merged)} a zsebben.`), variant: 'success' })
        },
      }),
    )
  }

  const menu = () => {
    const sid = currentSession()
    const entries: { title: string; description: string; run: () => void }[] = [
      { title: tr('This month', 'Ez a hónap'), description: tr('daily bars, models, cache', 'napi oszlopok, modellek, cache'), run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 0 })) },
      { title: tr('Last 7 days', 'Utolsó 7 nap'), description: '', run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 7 })) },
      { title: tr('Last 30 days', 'Utolsó 30 nap'), description: '', run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 30 })) },
      { title: tr('Tips and quest', 'Tippek és küldetés'), description: tr('savings tips, today\'s quest', 'megtakarítási tippek, mai küldetés'), run: () => void show('Frugalitas', () => tipsText({ ...common(sid), priceOf, pack: pack(), extra: tipExtras(sid) })) },
      { title: tr('Coins and rank', 'Garas és rang'), description: tr('what thrift has earned', 'amit a spórolás hozott'), run: () => void show('Frugalitas', async () => (budgets.daily > 0 ? xpText(ledger(), budgets.daily) : tr('Coins need a daily budget (dailyBudget in frugalitas.json).', 'Garashoz napi keret kell (dailyBudget a frugalitas.json-ban).'))) },
      { title: tr('Shop', 'Bolt'), description: tr('mascot skins and message packs: buy or wear', 'mascot-skinek és üzenet-packek: vásárlás, viselés'), run: () => shop() },
      { title: tr('Restart from a handover', 'Újrakezdés átadással'), description: tr('a small model summarises, a new session continues', 'kis modell összefoglal, új session folytatja'), run: () => void restart(false, sid) },
      { title: tr('Restart (Sonnet writes it)', 'Újrakezdés (Sonnet írja)'), description: tr('for conversations too big for Haiku', 'Haikunak túl nagy beszélgetésekhez'), run: () => void restart(true, sid) },
      { title: tr('Handovers', 'Átadások'), description: tr('read or continue from a saved one', 'mentett megnyitása vagy folytatása'), run: () => handovers() },
      { title: tr('Switch to Fukarléc (Hungarian)', 'Váltás Frugalitasra (angol)'), description: tr('words, characters and currency change; budgets and coins stay', 'a szavak, szereplők és pénznem változik; a keretek és garasok maradnak'), run: switchMode },
      { title: tr('Import coins from Claude Code', 'Garas importálása a Claude Code-ból'), description: tr('merge its ledger into this one; safe to repeat', 'a főkönyve beolvasztása ebbe; ismételhető'), run: importCoins },
      { title: tr('Refresh numbers', 'Számok frissítése'), description: tr('re-read today and month from LiteLLM', 'ma és hó újraolvasása'), run: () => void refresh().then(() => api.ui.toast({ title: 'Frugalitas', message: `today ${money(today() ?? 0)} · month ${money(month() ?? 0)}`, variant: 'info' })) },
    ]
    api.ui.dialog.setSize('medium')
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: tr('Frugalitas', 'Fukarléc'),
        options: entries.map((e, i) => ({ title: e.title, description: e.description || undefined, value: i })),
        onSelect: o => entries[o.value as number]!.run(),
      }),
    )
  }

  /** Sidebar block: budgets as bars, the cache countdown and the rank (spike). */
  const budgetRows = (sid: string, theme: any) => {
    const spend = spendOf(sid)
    const rows: [string, number, number][] = [
      [tr('session', 'session'), spend.session, budgets.session],
      [tr('today', 'ma'), spend.today, budgets.daily],
      [tr('month', 'hó'), spend.month, budgets.monthly],
    ]
    return rows
      .filter(([, , budget]) => budget > 0)
      .map(([name, spent, budget]) => {
        const ratio = spent / budget
        const color = ratio >= 1 ? theme.error : ratio >= 0.8 ? theme.warning : theme.success
        return (
          <box flexDirection="column">
            <text fg={theme.textMuted}>{`${name} ${money(spent)} / ${money(budget)}`}</text>
            <text fg={color}>{`${progressBar(Math.min(1, ratio), 16)}  ${Math.round(ratio * 100)}%`}</text>
          </box>
        )
      })
  }

  /** Sidebar advice: once the cache has expired, what the next turns cost each way; else one rotating tip. */
  const adviceBlock = (sid: string, theme: any) => {
    const s = sessions()[sid]
    const p = s && priceOf(s.model)
    const expired = s && p && s.warmSince > 0 && !busy(sid) && now() > s.warmSince + cacheTtl && s.ctx >= minContext
    const blocks: any[] = []
    if (expired && s && p) {
      const c = restartCosts(s.ctx, s.baseCtx, p, false)
      const restart = estimateRestart(s.ctx, s.baseCtx, s.model)
      const showRestart = restart !== undefined && restartWorthIt(restart, c)
      const row = (label: string, cost: number, best: boolean) => <text fg={best ? theme.success : theme.textMuted}>{`${best ? '▸' : ' '} ${label.padEnd(11)} ~${money(cost)}`}</text>
      blocks.push(
        <box flexDirection="column">
          <text fg={theme.warning}>{tr(`❄️ Cache expired · ${Math.round(s.ctx / 1000)}k context`, `❄️ Lejárt a cache · ${Math.round(s.ctx / 1000)}k context`)}</text>
          <text fg={theme.textMuted}>{tr('Next 10 turns:', 'Következő 10 kör:')}</text>
          {row(tr('keep going', 'folytatás'), c.keep, c.best === 'keep' && !showRestart)}
          {row('/compact', c.compact, c.best === 'compact' && !showRestart)}
          {showRestart ? row(tr('restart', 'újrakezdés'), restart!, true) : null}
          {row('/new', c.clear, false)}
          <text fg={theme.textMuted}>{tr('Same task: ▸ · new task: /new', 'Ugyanaz a feladat: ▸ · új feladat: /new')}</text>
        </box>,
      )
    }
    const a = advice()
    if (a && a.tips.length > 0) {
      const tip = localize(a.tips[Math.floor(now() / 20_000) % a.tips.length]!)
      blocks.push(
        <box flexDirection="column">
          <text fg={theme.textMuted}>{tr(`💡 Tip ${(Math.floor(now() / 20_000) % a.tips.length) + 1}/${a.tips.length}`, `💡 Tipp ${(Math.floor(now() / 20_000) % a.tips.length) + 1}/${a.tips.length}`)}</text>
          <text fg={theme.text}>{tip}</text>
        </box>,
      )
    }
    if (a?.quest) blocks.push(<text fg={theme.textMuted}>{a.quest}</text>)
    return blocks
  }

  const rendered = new Set<string>()
  api.slots.register({
    slots: {
      session_prompt_right(_ctx, props) {
        if (!rendered.has(props.session_id)) {
          rendered.add(props.session_id)
          void backfill(props.session_id)
        }
        return <text>{line(props.session_id)}</text>
      },
      sidebar_content(ctx, props) {
        modeSeen()
        const theme = ctx.theme.current
        const r = rankOf(earned(ledger()))
        const cache = cacheSuffix(props.session_id).replace(/^ · /, '')
        return (
          <box flexDirection="column" gap={1}>
            <text fg={theme.text}>
              <b>{tr('Frugalitas', 'Fukarléc')}</b>
            </text>
            {mascotScale ? <Mascot skin={skinById(worn(ledger()).skin)} ratio={worst(spendOf(props.session_id), budgets)?.ratio} scale={mascotScale} backdrop={mascotBackdrop} /> : null}
            {mascotScale ? <text fg={theme.textMuted}>{`„${pickLine(pack().sayings[mascotMood(worst(spendOf(props.session_id), budgets)?.ratio)], Number(date().slice(8)))}”`}</text> : null}
            {budgetRows(props.session_id, theme)}
            {cache ? <text fg={theme.textMuted}>{cache}</text> : null}
            <text fg={theme.textMuted}>{`${r.emoji} ${r.name} · ${balance(ledger())} ${tr('coins', 'garas')}`}</text>
            {adviceBlock(props.session_id, theme)}
          </box>
        )
      },
    },
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: 'frugal.report',
        title: 'Frugalitas: report',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal',
        run() {
          menu()
        },
      },
      {
        name: 'frugal.mode',
        title: 'Frugalitas: switch mode (Frugalitas / Fukarléc)',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal-mode',
        run: switchMode,
      },
      {
        name: 'frugal.restart',
        title: 'Frugalitas: restart from a handover (small model summarises, new session continues)',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal-restart',
        run: () => void restart(false, currentSession()),
      },
      {
        name: 'frugal.restart.sonnet',
        title: 'Frugalitas: restart from a handover, written by Sonnet',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal-restart-sonnet',
        run: () => void restart(true, currentSession()),
      },
      {
        name: 'frugal.handovers',
        title: 'Frugalitas: saved handovers',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal-handovers',
        run: handovers,
      },
      {
        name: 'frugal.allow',
        title: 'Frugalitas: allow prompts over budget today',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal-allow',
        run() {
          allowToday()
          api.ui.toast({ title: 'Frugalitas', message: tr('🔓 Unlocked for today.', '🔓 Mára feloldva.'), variant: 'success' })
        },
      },
    ],
    bindings: [],
  } as any)
}

const plugin: TuiPluginModule & { id: string } = { id: 'frugalitas.opencode', tui }
export default plugin
