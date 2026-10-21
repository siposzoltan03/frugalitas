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
  handoverMarkdown,
  handoverTitle,
  resumePrompt,
} from '../hooks/advice'
import type { Handover } from '../hooks/advice'
import { inKind, money, ratios, SCOPE_NAMES, statusLine, utcDate } from '../hooks/format'
import type { Budgets, Scope, Spend } from '../hooks/format'
import { fetchActivity, fetchPrices, priceFor } from '../hooks/litellm'
import type { Prices } from '../hooks/litellm'
import { asMode, setMode, tr } from '../hooks/mode'
import { fill, packById, pickLine, voice } from '../hooks/packs'
import { balance, buy, owns, wear, worn } from '../hooks/xp'
import type { Ledger } from '../hooks/xp'
import { creditDays, loadLedger, saveLedger, shopItems, shopRow, xpText } from './ledger'
import { listHandovers, rowsOf, writeHandover } from './restart'
import { reportText, tipsText } from './report'
import { allowToday, connFromConfig, fetchLite, loadOptions, numOption, PROVIDER, readBlocked, trace } from './shared'

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
  trace('tui plugin start')
  try {
    await run(api, entryOptions)
    trace('tui plugin ready')
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
  const hufRate = num('hufRate', 350)
  const isFun = options.fun !== false
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
  const [now, setNow] = createSignal(Date.now())
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

  const refresh = async () => {
    try {
      const t = Date.now()
      const d = utcDate(t)
      const a = await fetchActivity(fetchLite, conn, `${d.slice(0, 7)}-01`, d)
      setDate(d)
      setMonth(a.total.spend)
      setToday(a.days.find(x => x.date === d)?.metrics.spend ?? 0)
      setErr(undefined)
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
  const priced = new Map<string, { sid: string; cost: number }>() // messages update repeatedly while streaming
  const off = api.event.on('message.updated', ev => {
    const m = ev.properties.info
    if (m.role !== 'assistant' || m.providerID !== PROVIDER) return
    const p = priceOf(m.modelID)
    if (!p) return
    const t = m.tokens
    priced.set(m.id, { sid: m.sessionID, cost: t.input * p.input + t.output * p.output + t.cache.read * p.cacheRead + t.cache.write * p.cacheWrite })
    const s = sess(m.sessionID)
    s.cost = 0
    for (const v of priced.values()) if (v.sid === m.sessionID) s.cost += v.cost
    if (m.time.completed) {
      s.model = m.modelID
      s.ctx = t.input + t.cache.read + t.cache.write
      if (s.baseCtx === 0) s.baseCtx = s.ctx
      if (m.time.created >= s.warmSince) s.warmSince = m.time.created
      void refresh()
    }
    touch()
    checkBudgets(m.sessionID)
  })

  // A turn ends at session.idle: toast if it was expensive.
  const offIdle = api.event.on('session.idle', ev => {
    const s = sess(ev.properties.sessionID)
    const cost = s.cost - s.turnBase
    s.turnBase = s.cost
    if (expensiveTurn > 0 && cost >= expensiveTurn) {
      const message = isFun ? say(pack().turn, { cost: money(cost), kind: inKind(cost, hufRate) }, now()) : tr(`Expensive turn: +${money(cost)}`, `Drága kör: +${money(cost)}`)
      api.ui.toast({ title: 'Frugalitas', message, variant: 'warning', duration: 8000 })
    }
    touch()
  })

  const busy = (sid: string) => api.state.session.status(sid)?.type === 'busy'

  /** Once a second: move the countdown, warn ~30 s before a big context's cache expires, advise at expiry. */
  let blockedSeen = Date.now()
  const timer = setInterval(() => {
    const t = Date.now()
    setNow(t)
    const blocked = readBlocked()
    if (blocked && blocked.at > blockedSeen) {
      blockedSeen = blocked.at
      api.ui.toast({ title: '🔒 Frugalitas', message: blocked.message, variant: 'error', duration: 15_000 })
    }
    for (const [sid, s] of Object.entries(sessions())) {
      if (s.warmSince === 0 || busy(sid)) continue
      const remaining = s.warmSince + cacheTtl - t
      if (s.soonFor !== s.warmSince) {
        const warning = cacheSoonWarning(remaining, s.ctx, priceOf(s.model))
        if (warning) {
          s.soonFor = s.warmSince
          const message = isFun ? voice(warning, pack(), t) : warning
          api.ui.toast({ title: 'Frugalitas', message, variant: 'warning', duration: 20_000 })
          if (s.ctx * (priceOf(s.model)?.cacheWrite ?? 0) >= 0.5) void api.attention.notify({ title: 'Frugalitas', message: warning })
        }
      }
      if (remaining <= 0 && s.expiredFor !== s.warmSince) {
        s.expiredFor = s.warmSince
        const tip = clearOrRewriteTip(s.ctx, s.baseCtx, priceOf(s.model))
        if (tip) api.ui.toast({ title: 'Frugalitas', message: isFun ? voice(tip, pack(), t) : tip, variant: 'info', duration: 20_000 })
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
    err() && today() === undefined
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
  /** Message packs for coins; picking one buys it (when owned: wears it). */
  const shop = (note?: string) => {
    const l = ledger()
    api.ui.dialog.setSize('large')
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: tr(`🛒 Shop · ${balance(l)} coins${note ? ` · ${note}` : ''}`, `🛒 Bolt · ${balance(l)} garas${note ? ` · ${note}` : ''}`),
        options: shopItems().map(i => ({ ...shopRow(l, i), value: i.id })),
        onSelect: o => {
          const item = shopItems().find(i => i.id === o.value)!
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
    const res = await api.client.session.create({ body: { title: `🧳 ${handoverTitle(h.text) || h.id}` } })
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
      const msgs = await api.client.session.messages({ path: { id: sid } })
      const rows = rowsOf(msgs.data ?? [])
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

  const menu = () => {
    const sid = api.route.current.name === 'session' ? String((api.route.current as any).params?.sessionID ?? '') : undefined
    const entries: { title: string; description: string; run: () => void }[] = [
      { title: tr('This month', 'Ez a hónap'), description: tr('daily bars, models, cache', 'napi oszlopok, modellek, cache'), run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 0 })) },
      { title: tr('Last 7 days', 'Utolsó 7 nap'), description: '', run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 7 })) },
      { title: tr('Last 30 days', 'Utolsó 30 nap'), description: '', run: () => void show('Frugalitas', () => reportText({ ...common(sid), days: 30 })) },
      { title: tr('Tips and quest', 'Tippek és küldetés'), description: tr('savings tips, today\'s quest', 'megtakarítási tippek, mai küldetés'), run: () => void show('Frugalitas', () => tipsText({ ...common(sid), priceOf, pack: pack() })) },
      { title: tr('Coins and rank', 'Garas és rang'), description: tr('what thrift has earned', 'amit a spórolás hozott'), run: () => void show('Frugalitas', async () => (budgets.daily > 0 ? xpText(ledger(), budgets.daily) : tr('Coins need a daily budget (dailyBudget in frugalitas.json).', 'Garashoz napi keret kell (dailyBudget a frugalitas.json-ban).'))) },
      { title: tr('Shop', 'Bolt'), description: tr('message packs: buy or wear', 'üzenet-packek: vásárlás, viselés'), run: () => shop() },
      { title: tr('Restart from a handover', 'Újrakezdés átadással'), description: tr('a small model summarises, a new session continues', 'kis modell összefoglal, új session folytatja'), run: () => void restart(false, sid) },
      { title: tr('Restart (Sonnet writes it)', 'Újrakezdés (Sonnet írja)'), description: tr('for conversations too big for Haiku', 'Haikunak túl nagy beszélgetésekhez'), run: () => void restart(true, sid) },
      { title: tr('Handovers', 'Átadások'), description: tr('read or continue from a saved one', 'mentett megnyitása vagy folytatása'), run: () => handovers() },
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

  const rendered = new Set<string>()
  api.slots.register({
    slots: {
      session_prompt_right(_ctx, props) {
        if (!rendered.has(props.session_id)) {
          rendered.add(props.session_id)
          trace(`slot render ${props.session_id}`)
        }
        return <text>{line(props.session_id)}</text>
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
