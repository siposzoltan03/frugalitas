import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { addMetrics, emptyMetrics, fetchActivity, fetchKeySpend, fetchPrices, makeConn, priceFor } from './litellm'
import type { Activity, Conn, Day, Fetch, Metrics, Prices } from './litellm'
import {
  cacheExpiryWarning,
  cacheSoonWarning,
  cacheStatus,
  cacheTtlMs,
  clearOrRewriteTip,
  clock,
  restartCosts,
  compactEffectTip,
  contextGrowthTip,
  failedTip,
  forecastTip,
  outputTip,
  QUEST_XP,
  questFor,
  repeatReadTip,
  subagentTip,
  toolOutputTip,
  weekdayTip,
  weightedTokens,
} from './advice'
import {
  addDays,
  colorDotRasterCells,
  gaugeRasterCells,
  inKind,
  MODEL_COLORS,
  modelBarRasterCells,
  money,
  mood,
  ratios,
  report,
  SCOPE_NAMES,
  sparklineRasterCells,
  statusLine,
  streak,
  tips,
  utcDate,
  worst,
} from './format'
import type { Budgets, Scope, Spend } from './format'
import type { AdviceView, SnapshotState, TurnCost, XpView } from '../types'
import { MASCOT_COLUMNS, MASCOT_ROWS, mascotMood, mascotRasterCells } from './mascot'
import { fill, packById, PACKS, pickLine, voice } from './packs'
import type { Pack } from './packs'
import { skinById, SKINS } from './skins'
import { asLedger, balance, buy, credit, creditFrom, earned, owns, progressBar, rankOf, wear } from './xp'
import type { Ledger, ShopItem } from './xp'

const POLL_MS = 5 * 60_000
const MIN_REFRESH_MS = 10_000
const TIP_EVERY_MS = 30 * 60_000
const KEEP_MS = 40 * 86_400_000
const PANE_ID = 'penny-dashboard'
const TURN_DISPLAY_MS = 8_000

type Snapshot = { at: number; keySpend: number; today: Day | undefined; activity: Activity; date: string }
type Stamped = { at: number; [k: string]: unknown }

type Io = {
  now: () => Promise<number>
  fetch: Fetch
  get: (key: string) => Promise<Stamped | undefined>
  set: (key: string, value: Stamped) => Promise<void>
  del: (key: string) => Promise<void>
  keys: () => Promise<string[]>
  status: (text: string | undefined) => void
  toast: (text: string, timeoutMs: number) => void
  notify: (text: string) => void
  debug: (text: string) => void
  every: (ms: number, fn: () => void) => void
  after: (ms: number, fn: () => void) => void
  /** Tokens in the live context window, as the status line counts them. */
  contextTokens: () => Promise<number>
  model: () => Promise<string>
  /** Draws the pane again (its cache countdown reads the clock). */
  redraw: () => void
}

const snapshotAtom = atom({ plugin: 'penny-pincher', key: 'snapshot' } as const, null as SnapshotState | null)
const lastTurnAtom = atom({ plugin: 'penny-pincher', key: 'lastTurn' } as const, null as TurnCost | null)
const bandHiddenAtom = atom({ plugin: 'penny-pincher', key: 'bandHidden' } as const, false)
const xpAtom = atom({ plugin: 'penny-pincher', key: 'xp' } as const, null as XpView | null)
const adviceAtom = atom({ plugin: 'penny-pincher', key: 'advice' } as const, null as AdviceView | null)

const XP_KEY = 'xp'

const SHOP: readonly ShopItem[] = [
  ...SKINS.map(s => ({ kind: 'skin' as const, id: s.id, name: s.name, description: s.description, price: s.price })),
  ...PACKS.map(p => ({ kind: 'pack' as const, id: p.id, name: p.name, description: p.description, price: p.price })),
]

const xpView = (l: Ledger): XpView => ({ skin: l.skin, pack: l.pack, earned: earned(l), balance: balance(l) })

export const register: Register = (on, options) => {
  const budgets: Budgets = {
    session: Number(options.sessionBudget ?? 0),
    daily: Number(options.dailyBudget ?? 0),
    monthly: Number(options.monthlyBudget ?? 0),
  }
  const isBlocking = options.overBudget === 'block'
  const isFun = options.fun !== false
  const expensiveTurn = Number(options.expensiveTurn ?? 0)

  let io: Io | undefined
  let conn: Conn | undefined
  let sessionId = ''
  let baseline: number | undefined
  let snap: Snapshot | undefined
  let lastError: string | undefined
  let inflight: Promise<Snapshot | undefined> | undefined
  let lastTipAt = 0
  let ledger: Ledger | undefined
  let creditedOn = ''

  // What the advice reads beyond the snapshot: model prices, eight weeks of history,
  // and this session's own turns and tool calls.
  let prices: Record<string, Prices> = {}
  let history: Day[] = []
  let historyOn = ''
  let lastTurnEndAt = 0
  // The prompt cache countdown: warm for `cacheTtl` after the last main-thread turn ended.
  let cacheTtl = cacheTtlMs(undefined)
  let isTurnRunning = false
  let nowMs = 0
  let soonWarnedFor = 0
  let expiredToldFor = 0
  // What a fresh session starts with (context after this session's first turn), and the model last used.
  let baseContextTokens = 0
  let lastModel = ''
  let lastContextTokens = 0
  let mainTokens = 0
  let subTokens = 0
  const turnWeights: number[] = []
  let compact: { before: number[]; after: number[] } | undefined
  const readCounts = new Map<string, number>()
  const toldTips = new Set<string>()

  const pack = (): Pack => packById(ledger?.pack)
  const say = (lines: readonly string[], vars: Readonly<Record<string, string | number>>, seed: number) =>
    fill(pickLine(lines, seed), vars)

  const spendOf = (s: Snapshot): Spend => ({
    session: Math.max(0, s.keySpend - (baseline ?? s.keySpend)),
    today: s.today?.metrics.spend ?? 0,
    month: s.activity.total.spend,
  })

  function showStatus($io: Io) {
    if (!conn) return $io.status(undefined)
    if (!snap) return $io.status(lastError ? `🪙 ⚠︎ ${lastError}` : '🪙 …')
    $io.status(statusLine(spendOf(snap), budgets, isFun, lastError !== undefined) + cacheSuffix())
  }

  /** ` · ⏳ cache 3:42` after a turn; nothing before the first turn or while one runs. */
  function cacheSuffix(): string {
    if (lastTurnEndAt === 0 || isTurnRunning || nowMs === 0) return ''
    return ` · ${cacheStatus(lastTurnEndAt + cacheTtl - nowMs)}`
  }

  /** Once a second: move the countdown, and warn ~30 s before a big context's cache expires. */
  async function tick($io: Io) {
    nowMs = await $io.now()
    if (lastTurnEndAt === 0 || isTurnRunning) return
    const remaining = lastTurnEndAt + cacheTtl - nowMs
    if (remaining < -2_000) return // already shows expired
    showStatus($io)
    if (remaining <= 0 && expiredToldFor !== lastTurnEndAt) {
      expiredToldFor = lastTurnEndAt
      const tip = clearOrRewriteTip(lastContextTokens, baseContextTokens, priceOf(lastModel))
      if (tip) $io.toast(isFun ? voice(tip, pack(), nowMs) : tip, 20_000)
      $io.redraw()
    }
    if (Math.ceil(remaining / 1000) % 5 === 0) $io.redraw()
    if (soonWarnedFor !== lastTurnEndAt) {
      const warning = cacheSoonWarning(remaining, lastContextTokens, priceOf(await $io.model().catch(() => '')))
      if (warning) {
        soonWarnedFor = lastTurnEndAt
        $io.toast(isFun ? voice(warning, pack(), nowMs) : warning, 20_000)
        if (lastContextTokens * (priceOf(await $io.model().catch(() => ''))?.cacheWrite ?? 0) >= 0.5) $io.notify(warning)
      }
    }
  }

  async function load($io: Io): Promise<Snapshot> {
    const now = await $io.now()
    const date = utcDate(now)
    const fetch = $io.fetch
    const [keySpend, activity] = await Promise.all([
      fetchKeySpend(fetch, conn!),
      fetchActivity(fetch, conn!, `${date.slice(0, 7)}-01`, date),
    ])
    return { at: now, keySpend, activity, date, today: activity.days.find(d => d.date === date) }
  }

  async function refresh($io: Io, force = false): Promise<Snapshot | undefined> {
    if (!conn) return undefined
    if (inflight && !force) return inflight
    if (inflight) await inflight
    if (snap && !force && (await $io.now()) - snap.at < MIN_REFRESH_MS) return snap
    inflight = (async () => {
      try {
        snap = await load($io)
        lastError = undefined
        if (baseline === undefined) {
          baseline = snap.keySpend
          await $io.set(`baseline:${sessionId}`, { at: snap.at, spend: baseline })
        }
        await checkBudgets($io, snap)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        $io.debug(`penny-pincher: ${lastError}`)
      } finally {
        inflight = undefined
        showStatus($io)
      }
      return snap
    })()
    return inflight
  }

  function periodOf(scope: Scope, s: Snapshot): string {
    if (scope === 'session') return sessionId
    if (scope === 'daily') return s.date
    return s.date.slice(0, 7)
  }

  async function checkBudgets($io: Io, s: Snapshot) {
    const spend = spendOf(s)
    const spentBy: Record<Scope, number> = { session: spend.session, daily: spend.today, monthly: spend.month }
    for (const [scope, ratio] of Object.entries(ratios(spend, budgets)) as [Scope, number][]) {
      const level = ratio >= 1 ? 2 : ratio >= 0.8 ? 1 : 0
      if (level === 0) continue
      const key = `warned:${scope}:${periodOf(scope, s)}`
      const told = Number((await $io.get(key))?.level ?? 0)
      if (level <= told) continue
      await $io.set(key, { at: s.at, level })
      if (level === 1) {
        const vars = { scope: SCOPE_NAMES[scope], pct: Math.round(ratio * 100) }
        $io.toast(isFun ? say(pack().warn, vars, s.at) : `penny: ${vars.scope} budget at ${vars.pct}%`, 8000)
      } else {
        const text = isFun
          ? say(
              pack().over,
              {
                scope: SCOPE_NAMES[scope],
                spent: money(spentBy[scope]),
                budget: money(budgets[scope]),
                kind: inKind(spentBy[scope]),
              },
              s.at,
            )
          : `penny: ${SCOPE_NAMES[scope]} budget exceeded (${money(spentBy[scope])}/${money(budgets[scope])})`
        $io.toast(text, 12_000)
        $io.notify(text)
        if (isBlocking) $io.toast('🔒 New prompts are blocked until /penny allow.', 12_000)
      }
    }
  }

  function paneTipFromActivity(activity: Activity, today: Day | undefined, _b: Budgets): string | undefined {
    const t = activity.total
    // Before today's first request (every day after 00:00 UTC) read the last active day instead.
    const day = today ?? activity.days.filter(d => d.metrics.spend > 0).at(-1)
    if (day) {
      const when = today ? 'Today' : 'Last active day'
      const m = day.metrics
      const dayModels = Object.entries(day.models).filter(([, mm]) => mm.spend > 0.1)
      const opus = dayModels.find(([n]) => /opus/i.test(n))
      if (opus && m.spend > 0 && opus[1].spend / m.spend > 0.7) {
        const pct = Math.round((opus[1].spend / m.spend) * 100)
        return `🧠 ${when}: ${pct}% Opus. For routine work /model sonnet is cheaper.`
      }
      const input = m.promptTokens
      if (input > 500_000 && m.cacheRead / input < 0.7) {
        return `🧊 ${when}: cache hit ${Math.round((m.cacheRead / input) * 100)}%. Model switches and /clear hurt it.`
      }
      if (m.completionTokens > 0 && m.promptTokens / m.completionTokens > 15) {
        return '📐 Long context, little output — /compact cuts the prompt tokens.'
      }
      if (dayModels.length > 3) {
        return `🔀 ${when}: ${dayModels.length} models used. Every model switch invalidates the cache.`
      }
    }
    if (t.cacheSaved > 0) {
      return `🦸 The cache has saved ${money(t.cacheSaved)} so far — ${Math.round(t.cacheSaved / (t.spend + t.cacheSaved) * 100)}% off.`
    }
    return '💡 /compact mid-session: a smaller context means fewer tokens per turn.'
  }

  function xpText(l: Ledger): string {
    const total = earned(l)
    const r = rankOf(total)
    const recent = Object.entries(l.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7)
    return [
      `${r.emoji} ${r.name} · ${total} coins earned · ${balance(l)} in your pocket`,
      r.next ? `${progressBar(r.progress)} → ${r.next.name} (${r.next.at})` : `${progressBar(1)} top rank!`,
      `Skin: ${skinById(l.skin).name} · Pack: ${packById(l.pack).name}`,
      '',
      recent.length > 0
        ? `Recent days: ${recent
            .map(([d, xp]) => `${d.slice(5)} ${xp > 0 ? `+${xp + (l.quests[d] ?? 0)}${l.quests[d] ? '🎯' : ''}` : '0 🔥'}`)
            .join(' · ')}`
        : 'No credited days yet: coins are paid for closed (UTC) days.',
      `Rule: an active day within the daily budget (${money(budgets.daily)}) = 10 + up to 10 for thrift + streak bonus (up to +10);`,
      `a completed daily quest +${QUEST_XP}.`,
      ...(snap ? [questLine(snap) ?? ''] : []),
    ].join('\n')
  }

  function shopText(l: Ledger): string {
    const line = (i: ShopItem) => {
      const worn = i.kind === 'skin' ? l.skin === i.id : l.pack === i.id
      const mark = worn ? '👉' : owns(l, i) ? '✅' : '🔒'
      const price = i.price === 0 ? 'free' : `${i.price} coins`
      return `  ${mark} ${i.id.padEnd(11)} ${i.name.padEnd(16)} ${price.padStart(10)}  ${i.description}`
    }
    return [
      `🛒 Old Penny's shop · in your pocket: ${balance(l)} coins`,
      '',
      'Skins:',
      ...SHOP.filter(i => i.kind === 'skin').map(line),
      '',
      'Message packs:',
      ...SHOP.filter(i => i.kind === 'pack').map(line),
      '',
      '👉 wearing · ✅ owned · 🔒 for sale',
      'Buy: /penny buy <id> · change (free): /penny skin <id>, /penny pack <id>',
    ].join('\n')
  }

  async function loadLedger($io: Io, s: Snapshot): Promise<Ledger> {
    ledger = asLedger(await $io.get(XP_KEY), s.date, s.at)
    return ledger
  }

  async function saveLedger($io: Io, l: Ledger) {
    ledger = l
    await $io.set(XP_KEY, l as unknown as Stamped)
  }

  /** Once a day: credit the closed days since the last credit, and say so. */
  async function creditXp($io: Io, s: Snapshot): Promise<XpView> {
    if (creditedOn === s.date && ledger) return xpView(ledger)
    let l = await loadLedger($io, s)
    const from = creditFrom(l)
    const to = addDays(s.date, -1)
    if (budgets.daily > 0 && from <= to) {
      try {
        const activity = await fetchActivity($io.fetch, conn!, from, to)
        const result = credit(l, activity.days, s.date, budgets.daily)
        l = result.ledger
        if (result.gained > 0) {
          const quests = result.quests.length > 0 ? ` 🎯 (${result.quests.length} quest${result.quests.length > 1 ? 's' : ''})` : ''
          $io.toast((isFun ? say(pack().xp, { xp: result.gained }, s.at) : `penny: +${result.gained} coins`) + quests, 10_000)
        }
      } catch (err) {
        $io.debug(`penny-pincher xp: ${err instanceof Error ? err.message : String(err)}`)
        return xpView(l)
      }
    }
    await saveLedger($io, l)
    creditedOn = s.date
    return xpView(l)
  }

  /**
   * Toasts a tip once per key, in the pack's voice. Ordinary tips keep 30 minutes
   * apart; urgent ones (about the turn at hand) only never repeat.
   */
  async function offerTip($io: Io, key: string, tip: string | undefined, urgent = false) {
    if (!tip || toldTips.has(key)) return
    const now = await $io.now()
    if (!urgent && now - lastTipAt < TIP_EVERY_MS) return
    toldTips.add(key)
    if (!urgent) lastTipAt = now
    $io.toast(isFun ? voice(tip, pack(), now) : tip.replace(/^\S+\s/, 'Tipp: '), 15_000)
  }

  const priceOf = (model: string) => priceFor(prices, model)

  /** Prices once a session, history once a day; each failure leaves the advice that needs it out. */
  async function loadExtras($io: Io, s: Snapshot) {
    if (Object.keys(prices).length === 0) {
      prices = await fetchPrices($io.fetch, conn!).catch(() => ({}))
    }
    if (historyOn !== s.date) {
      try {
        history = (await fetchActivity($io.fetch, conn!, addDays(s.date, -56), s.date)).days
        historyOn = s.date
      } catch (err) {
        $io.debug(`penny-pincher history: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  function questLine(s: Snapshot): string | undefined {
    if (budgets.daily <= 0) return undefined
    const q = questFor(s.date)
    const sofar = s.today ? (q.done(s.today, budgets.daily) ? ' · so far ✅' : ' · so far ❌') : ''
    return `🎯 Today's quest: ${q.text} (+${QUEST_XP} coins)${sofar}`
  }

  /** The advice that rests on LiteLLM's numbers, freshest first. */
  async function adviceFor($io: Io, s: Snapshot): Promise<AdviceView> {
    await loadExtras($io, s)
    const lastActive = s.today ?? s.activity.days.filter(d => d.metrics.spend > 0).at(-1)
    const list = [
      ...tips(s.today, 0),
      forecastTip(s.activity.total.spend, s.date, budgets.monthly),
      outputTip(lastActive, priceOf),
      failedTip(lastActive),
      weekdayTip(history),
      lastTurnEndAt > 0 && !isTurnRunning && nowMs > lastTurnEndAt + cacheTtl
        ? clearOrRewriteTip(lastContextTokens, baseContextTokens, priceOf(lastModel))
        : undefined,
    ].filter((t): t is string => t !== undefined)
    const seed = Number(s.date.slice(8))
    return {
      tips: isFun ? list.map((t, i) => voice(t, pack(), seed + i)) : list,
      quest: questLine(s) ?? null,
    }
  }

  function overScopes(): Scope[] {
    if (!snap) return []
    return (Object.entries(ratios(spendOf(snap), budgets)) as [Scope, number][]).filter(([, r]) => r >= 1).map(([s]) => s)
  }

  async function prune($io: Io) {
    const now = await $io.now()
    for (const key of await $io.keys()) {
      const value = await $io.get(key)
      if (typeof value?.at === 'number' && now - value.at > KEEP_MS) await $io.del(key)
    }
  }

  // --- session.start -----------------------------------------------------------

  on('session.start', async ($, e, next) => {
    io = {
      now: () => $.clock.now(),
      fetch: (url, init) => $.http.fetch(url, init),
      get: async key => (await $.store.get(key)) as Stamped | undefined,
      set: (key, value) => $.store.set(key, value),
      del: key => $.store.delete(key),
      keys: () => $.store.keys(),
      status: text => $.ui.status(text),
      toast: (text, timeoutMs) => $.ui.toast(text, { timeoutMs }),
      notify: text => void $.ui.notify(text, { title: 'Penny Pincher' }).catch(() => {}),
      debug: text => $.ui.log(text, { to: 'debug' }),
      every: (ms, fn) => void $.clock.every(ms, fn),
      after: (ms, fn) => void $.clock.after(ms, fn),
      contextTokens: async () => (await $.session.usage()).context.tokens ?? 0,
      model: () => $.session.model(),
      redraw: () => $.ui.invalidate('ui.render'),
    }
    await $.command.register({
      name: 'penny',
      description: 'LiteLLM cost report: /penny [<N> | refresh | allow | panel | tips | xp | shop | buy <id>]',
    })
    conn = makeConn({
      baseUrl: await $.env.get('ANTHROPIC_BASE_URL'),
      authToken: await $.env.get('ANTHROPIC_AUTH_TOKEN'),
      apiKey: await $.env.get('ANTHROPIC_API_KEY'),
      customHeaders: await $.env.get('ANTHROPIC_CUSTOM_HEADERS'),
    })
    if (conn) {
      const $io = io
      sessionId = await $.session.id()
      const turnEnd = await $io.get(`turnEnd:${sessionId}`)
      if (typeof turnEnd?.at === 'number') lastTurnEndAt = turnEnd.at
      if (typeof turnEnd?.base === 'number') baseContextTokens = turnEnd.base
      // The live context and model, so the keep / compact / clear prices show before the next turn.
      lastContextTokens = await $io.contextTokens().catch(() => 0)
      lastModel = await $io.model().catch(() => '')
      // A session with no turn yet holds just what a fresh one starts with.
      if (baseContextTokens === 0 && lastTurnEndAt === 0 && lastContextTokens > 0) baseContextTokens = lastContextTokens
      const kept = await $io.get(`baseline:${sessionId}`)
      baseline = typeof kept?.spend === 'number' ? kept.spend : undefined
      showStatus($io)
      void refresh($io).then(async s => {
        if (s) {
          void update($, snapshotAtom, () => ({
            spend: spendOf(s),
            activity: s.activity,
            date: s.date,
            stale: false,
          }))
          const view = await creditXp($io, s)
          await update($, xpAtom, () => view)
          const advice = await adviceFor($io, s)
          await update($, adviceAtom, () => advice)
        }
      })
      void prune($io).catch(() => {})
      const ttlEnv = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
      const settings = (await $.settings.read()) as Record<string, unknown>
      cacheTtl = cacheTtlMs(ttlEnv ?? settings.promptCacheTtl)
      $io.every(1_000, () => void tick($io))
      $io.every(POLL_MS, () => {
        void refresh($io).then(async s => {
          if (s) {
            void update($, snapshotAtom, () => ({
              spend: spendOf(s),
              activity: s.activity,
              date: s.date,
              stale: lastError !== undefined,
            }))
            const view = await creditXp($io, s)
            await update($, xpAtom, () => view)
            const advice = await adviceFor($io, s)
            await update($, adviceAtom, () => advice)
          }
        })
      })
    }
    return next(e)
  })

  // --- turn.complete -----------------------------------------------------------

  on('turn.start', async ($, e, next) => {
    if (io) {
      isTurnRunning = true
      showStatus(io)
      io.redraw()
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = false
      if (e.usage?.model) lastModel = e.usage.model
      lastTurnEndAt = nowMs = await $.clock.now()
      if (io && sessionId) void io.set(`turnEnd:${sessionId}`, { at: lastTurnEndAt, base: baseContextTokens }).catch(() => {})
    }
    const u = e.usage
    if (u) {
      const tokens = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      if (e.agentId === undefined) mainTokens += tokens
      else subTokens += tokens
    }
    if (conn && io && e.agentId === undefined) {
      const $io = io
      const cacheWrite = e.usage?.cache_creation_input_tokens ?? 0
      const price = u && priceOf(u.model)
      if (u && price) {
        const weight = weightedTokens(
          { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens },
          price,
        )
        turnWeights.push(weight)
        if (turnWeights.length > 50) turnWeights.shift()
        if (compact) compact.after.push(weight)
      }
      $io.after(0, () => {
        void (async () => {
          lastContextTokens = await $io.contextTokens().catch(() => lastContextTokens)
          if (baseContextTokens === 0 && lastContextTokens > 0) baseContextTokens = lastContextTokens
          const model = await $io.model().catch(() => '')
          const step = Math.floor(lastContextTokens / 100_000)
          await offerTip($io, `ctx:${step}`, contextGrowthTip(lastContextTokens, priceOf(model)))
          await offerTip($io, 'sub', subagentTip(mainTokens, subTokens))
          if (compact) {
            const tip = compactEffectTip(compact.before, compact.after)
            if (tip || compact.after.length >= 3) {
              await offerTip($io, `compact:${turnWeights.length}`, tip, true)
              compact = undefined
            }
          }
        })()
        const before = snap?.keySpend
        void refresh($io, true).then(async s => {
          if (!s) return
          await update($, snapshotAtom, () => ({
            spend: spendOf(s),
            activity: s.activity,
            date: s.date,
            stale: lastError !== undefined,
          }))
          if (before !== undefined && expensiveTurn > 0 && s.keySpend - before >= expensiveTurn) {
            const cost = s.keySpend - before
            $io.toast(
              isFun ? say(pack().turn, { cost: money(cost), kind: inKind(cost) }, s.at) : `Expensive turn: +${money(cost)}`,
              8000,
            )
            await update($, lastTurnAtom, () => ({
              cost: s.keySpend - before,
              inputTokens: 0,
              outputTokens: 0,
              at: s.at,
            }))
            $io.after(TURN_DISPLAY_MS, () => void update($, lastTurnAtom, () => null))
          }
          const advice = await adviceFor($io, s)
          await update($, adviceAtom, () => advice)
          const tip = tips(s.today, cacheWrite).find(t => !toldTips.has(`${s.date}:${t.slice(0, 2)}`))
          if (tip) await offerTip($io, `${s.date}:${tip.slice(0, 2)}`, tip)
        })
      })
    }
    return next(e)
  })

  // --- tool.call: outputs that fill the context ----------------------------------

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!conn || !io || e.agentId !== undefined || ran.deny !== undefined) return ran
    const chars = (ran.text ?? JSON.stringify(ran.result ?? '')).length
    if (e.tool === 'Read') {
      const count = (readCounts.get(e.file_path) ?? 0) + 1
      readCounts.set(e.file_path, count)
      await offerTip(io, `read:${e.file_path}`, repeatReadTip(e.file_path, count), true)
      await offerTip(io, `out:Read:${e.file_path}`, toolOutputTip('Read', e.file_path.replace(/^.*\//, ''), chars), true)
    } else if (e.tool === 'Bash') {
      const what = e.command.trim().split(/\s+/).slice(0, 2).join(' ')
      await offerTip(io, `out:Bash:${what}`, toolOutputTip('Bash', what, chars), true)
    } else {
      await offerTip(io, `out:${e.tool}`, toolOutputTip(String(e.tool), '', chars), true)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // --- session.compact: measure what it saved ------------------------------------

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !('skip' in done) && turnWeights.length >= 3) {
      compact = { before: turnWeights.slice(-3), after: [] }
    }
    return done
 }).catch(($, e, next) => next(e))

  // --- prompt.submit: cache-expiry warning, then the budget gate -----------------

  on('prompt.submit', async ($, e, next) => {
    // An expired cache, said before the turn pays for it.
    if (conn && io && lastTurnEndAt > 0 && e.origin.kind === 'composer') {
      const idle = (await $.clock.now()) - lastTurnEndAt
      const warning = cacheExpiryWarning(idle, lastContextTokens, priceOf(await $.session.model()), cacheTtl)
      await offerTip(io, `cache:${lastTurnEndAt}`, warning, true)
    }
    if (!isBlocking || !conn || !snap || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    const over = overScopes()
    if (over.length === 0 || (await $.store.get(`unlock:${snap.date}`)) !== undefined) return next(e)
    const names = over.map(s => SCOPE_NAMES[s]).join(', ')
    return { drop: `🔒 Penny Pincher: the ${names} budget is used up. If you really need to: /penny allow (lifts it until midnight UTC).` }
  }).catch(($, e, next) => next(e))

  // --- /penny command -------------------------------------------------------

  on('command.run', { command: 'penny' }, async ($, e) => {
    const $io = io
    if (!conn || !$io) {
      return {
        text: 'Penny Pincher: this session is not running through a LiteLLM proxy (no ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN), so there is nothing to watch.',
      }
    }
    const arg = e.args.trim().toLowerCase()

    if (arg === 'help' || arg === '?') {
      return {
        text: [
          "/penny            – this month's report",
          '/penny <N>        – the last N days',
          '/penny refresh    – reload the numbers',
          '/penny allow      – lift the over-budget block for today',
          '/penny panel      – open the cost dashboard',
          "/penny tips       – every current savings tip and today's quest",
          '/penny xp         – your rank and coins',
          '/penny shop       – skins and message packs',
          '/penny buy <id>   – buy with coins (and wear it)',
          '/penny skin <id>  – wear an owned skin · /penny pack <id> – use an owned pack (never buys)',
          '',
          `Budgets: session ${money(budgets.session)}, daily ${money(budgets.daily)}, monthly ${money(budgets.monthly)} · mode: ${isBlocking ? 'block' : 'warn'} (/config → penny-pincher)`,
        ].join('\n'),
      }
    }

    if (arg === 'panel' || arg === 'pane' || arg === 'dashboard') {
      await $.ui.open({ id: PANE_ID, title: '🪙 Penny Pincher' })
      return { text: 'Dashboard opened.' }
    }

    if (arg === 'allow') {
      const now = await $.clock.now()
      await $.store.set(`unlock:${utcDate(now)}`, { at: now })
      return { text: '🔓 Fine, unlocked for today. Old Penny suffers in silence.' }
    }

    const s = await refresh($io, true)
    if (!s) return { text: `Penny Pincher: LiteLLM is not answering (${lastError ?? 'unknown error'}).` }

    const [verb = '', ...rest] = arg.split(/\s+/)
    if (verb === 'tips' || verb === 'tip') {
      const advice = await adviceFor($io, s)
      await update($, adviceAtom, () => advice)
      const quest = budgets.daily > 0 ? questLine(s) : undefined
      return {
        text: [
          '💡 Savings tips',
          ...(advice.tips.length > 0 ? advice.tips.map(t => `  ${t}`) : ['  No specific tips right now — nice work!']),
          ...(quest ? ['', quest] : []),
        ].join('\n'),
      }
    }
    if (['xp', 'shop', 'buy', 'skin', 'pack'].includes(verb)) {
      const view = await creditXp($io, s)
      await update($, xpAtom, () => view)
      const l = ledger!
      if (budgets.daily <= 0) return { text: 'Penny Pincher: coins need a daily budget (/config → penny-pincher → Daily budget).' }

      if (verb === 'xp') return { text: xpText(l) }
      if (verb === 'shop') return { text: shopText(l) }

      const id = rest.join(' ')
      const matches = SHOP.filter(i => i.id === id && (verb === 'buy' || i.kind === verb))
      if (matches.length === 0) return { text: `No such item: "${id}". See /penny shop` }
      if (matches.length > 1) {
        const ownsAll = matches.every(i => owns(l, i))
        return {
          text: `"${id}" is both a skin and a pack${ownsAll ? ', both free and already yours' : ''}. To wear: /penny skin ${id} or /penny pack ${id}`,
        }
      }
      const item = matches[0]!
      const result = verb === 'buy' ? buy(l, item) : wear(l, item)
      if ('error' in result) return { text: `🪙 ${result.error}` }
      await saveLedger($io, result.ledger)
      await update($, xpAtom, () => xpView(result.ledger))
      return {
        text:
          verb === 'buy'
            ? `🛒 Bought and wearing: ${item.name} (${item.price} coins). ${balance(result.ledger)} left. Old Penny sheds a tear.`
            : `${item.kind === 'skin' ? '👕' : '💬'} Now using: ${item.name}.`,
      }
    }

    await update($, snapshotAtom, () => ({
      spend: spendOf(s),
      activity: s.activity,
      date: s.date,
      stale: false,
    }))

    if (arg === 'refresh') {
      return { text: statusLine(spendOf(s), budgets, isFun, false) }
    }

    const fetch = $io.fetch
    const days = /^\d+$/.test(arg) ? Math.min(92, Math.max(1, Number(arg))) : 0
    const start = days > 0 ? addDays(s.date, -(days - 1)) : `${s.date.slice(0, 7)}-01`
    const activity = days > 0 ? await fetchActivity(fetch, conn, start, s.date) : s.activity
    const history = budgets.daily > 0 ? await fetchActivity(fetch, conn, addDays(s.date, -60), s.date) : undefined

    return {
      text: report({
        title: days > 0 ? `🪙 Penny Pincher – last ${days} days (${start} → ${s.date}, UTC)` : `🪙 Penny Pincher – ${s.date.slice(0, 7)}`,
        activity,
        spend: spendOf(s),
        budgets,
        todayDate: s.date,
        fun: isFun,
        streakDays: history ? streak(history.days, s.date, budgets.daily) : 0,
      }),
    }
  })

  // --- Pane dashboard ----------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e) // Raster is a terminal element
    const state = await read($, snapshotAtom)
    const xp = await read($, xpAtom)
    const cacheLeft = lastTurnEndAt > 0 && !isTurnRunning ? lastTurnEndAt + cacheTtl - (await $.clock.now()) : undefined
    const lastPrice = priceOf(lastModel)
    const restart =
      cacheLeft !== undefined && cacheLeft <= 0 && lastPrice && lastContextTokens >= 50_000
        ? restartCosts(lastContextTokens, baseContextTokens, lastPrice, false)
        : undefined
    const advice = await read($, adviceAtom)
    const { Box, Text, Raster } = $.ui.resolve(e)
    const paneCols = e.props.bodyColumns ?? 40

    if (!state) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{conn ? '🪙 Loading...' : '🪙 No LiteLLM connection'}</Text>
        </Box>
      )
    }

    const { spend, activity, date } = state
    const gaugeWidth = Math.min(30, Math.max(10, paneCols - 16))
    const w = worst(spend, budgets)
    const moodEmoji = isFun && w ? mood(w.ratio) : ''

    const scopes: { label: string; spent: number; budget: number }[] = [
      { label: 'Session', spent: spend.session, budget: budgets.session },
      { label: 'Today  ', spent: spend.today, budget: budgets.daily },
      { label: 'Month  ', spent: spend.month, budget: budgets.monthly },
    ]

    const models = new Map<string, Metrics>()
    for (const d of activity.days) {
      for (const [name, m] of Object.entries(d.models)) models.set(name, addMetrics(models.get(name) ?? emptyMetrics(), m))
    }
    const allModels = [...models].sort((a, b) => b[1].spend - a[1].spend)
    const totalSpend = activity.total.spend

    const sparkDays = activity.days.slice(-14)
    const sparkValues = sparkDays.map(d => d.metrics.spend)
    const colsPerDay = sparkValues.length > 0 ? Math.max(2, Math.floor((paneCols - 2) / sparkValues.length)) : 2
    const sparkCols = Math.min(paneCols - 2, sparkValues.length * colsPerDay)
    const sparkRows = 7

    const modelShares = allModels.map(([, m], i) => ({
      ratio: totalSpend > 0 ? m.spend / totalSpend : 0,
      color: MODEL_COLORS[i % MODEL_COLORS.length]!,
    }))
    const modelBarWidth = Math.min(paneCols - 4, Math.max(10, paneCols - 4))

    const cacheHit = activity.total.promptTokens > 0
      ? Math.round((activity.total.cacheRead / activity.total.promptTokens) * 100)
      : 0

    const streakDays = budgets.daily > 0 ? streak(activity.days, date, budgets.daily) : 0

    const todayDay = activity.days.find(d => d.date === date)
    const todayTips = todayDay ? tips(todayDay, 0) : []
    const paneTip = todayTips[0] ?? advice?.tips[0] ?? paneTipFromActivity(activity, todayDay, budgets)
    const paneSparkValues: number[] = []
    for (const v of sparkValues) {
      for (let c = 0; c < colsPerDay; c++) paneSparkValues.push(v)
    }

    return (
      <Box flexDirection="column">
        <Text bold>🪙 Penny Pincher {moodEmoji} {date}</Text>
        <Text> </Text>


        {scopes.filter(s => s.budget > 0).map(s => {
          const r = s.budget > 0 ? s.spent / s.budget : 0
          return (
            <Box key={`scope-${s.label}`}>
              <Text dimColor>{s.label} </Text>
              <Raster key={`gauge-${s.label}`} columns={gaugeWidth} rows={1} cells={gaugeRasterCells(gaugeWidth, r)} />
              <Text> {money(s.spent)}/{money(s.budget)}</Text>
            </Box>
          )
        })}

        <Text> </Text>
        <Text bold>Last {sparkDays.length} days</Text>
        {sparkCols > 0 && (
          <Raster
            key="pane-spark"
            columns={sparkCols}
            rows={sparkRows}
            cells={sparklineRasterCells(paneSparkValues, sparkCols, sparkRows, budgets.daily)}
          />
        )}
        {sparkDays.length > 0 && (
          <Text dimColor>
            {sparkDays.map((d, i) => {
              const label = d.date.slice(8)
              const pad = colsPerDay - label.length
              return i < sparkDays.length - 1 ? label + ' '.repeat(Math.max(0, pad)) : label
            }).join('')}
          </Text>
        )}

        <Text> </Text>
        <Text bold>Modellek</Text>
        {modelShares.length > 0 && (
          <Raster key="model-bar" columns={modelBarWidth} rows={1} cells={modelBarRasterCells(modelShares, modelBarWidth)} />
        )}
        {allModels.map(([name, m], i) => {
          const short = name.replace(/^.*\//, '')
          const pct = totalSpend > 0 ? Math.round((m.spend / totalSpend) * 100) : 0
          const dotColor = MODEL_COLORS[i % MODEL_COLORS.length]!
          return (
            <Box key={`model-${i}`}>
              <Raster key={`dot-${i}`} columns={1} rows={1} cells={colorDotRasterCells(dotColor)} />
              <Text dimColor> {short} {money(m.spend)} ({pct}%)</Text>
            </Box>
          )
        })}

        <Text> </Text>
        <Text dimColor>Cache: {cacheHit}% hit, {money(activity.total.cacheSaved)} saved</Text>
        {lastTurnEndAt === 0 && !isTurnRunning && <Text dimColor>⏳ Cache: starts when the next turn ends</Text>}
        {isTurnRunning && <Text dimColor>⏳ Cache: fresh (turn running)</Text>}
        {cacheLeft !== undefined && (
          <Text color={cacheLeft <= 0 ? '#60a5fa' : cacheLeft <= 60_000 ? '#ef4444' : undefined} dimColor={cacheLeft > 60_000}>
            {cacheLeft > 0
              ? `⏳ Cache: ${clock(cacheLeft)} ${progressBar(cacheLeft / cacheTtl, 10)}`
              : '❄️ Cache: expired — the next turn rewrites the context'}
          </Text>
        )}
        {restart && (
          <Text dimColor>
            {'   '}next 10 turns: keep going ~{money(restart.keep)} · /compact ~{money(restart.compact)} · /clear ~
            {money(restart.clear)} → {restart.best === 'compact' ? '/compact' : 'keep going'} (new task: /clear)
          </Text>
        )}
        <Text dimColor>Total: {money(totalSpend)} · {activity.total.requests} requests</Text>

        {isFun && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text>{inKind(totalSpend)}</Text>
            {streakDays >= 2 && <Text color="#22c55e">{'🏆'} {streakDays} days within budget!</Text>}
          </Box>
        )}

        {paneTip !== undefined && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Tipp</Text>
            <Text dimColor>{paneTip}</Text>
            {isFun && advice?.quest && <Text dimColor>{advice.quest}</Text>}
          </Box>
        )}
        {isFun && paneCols >= MASCOT_COLUMNS + 2 && <Text> </Text>}
        {isFun && paneCols >= MASCOT_COLUMNS + 2 && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Raster key="mascot" columns={MASCOT_COLUMNS} rows={MASCOT_ROWS} cells={mascotRasterCells(skinById(xp?.skin), mascotMood(w?.ratio))} />
            {paneCols >= MASCOT_COLUMNS + 24 && (
              <Box borderStyle="round" borderDimColor paddingX={1} flexShrink={1}>
                <Text italic>„{pickLine(packById(xp?.pack).sayings[mascotMood(w?.ratio)], Number(date.slice(8)))}”</Text>
              </Box>
            )}
          </Box>
        )}
        {isFun && xp && budgets.daily > 0 && (() => {
          const r = rankOf(xp.earned)
          return (
            <Text dimColor>
              {r.emoji} {r.name} · {xp.balance} coins · {progressBar(r.progress, 10)}
              {r.next ? ` → ${r.next.name}` : ''}
            </Text>
          )
        })()}
      </Box>
    )
  })

}
