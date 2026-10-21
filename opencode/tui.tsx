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
} from '../hooks/advice'
import { inKind, money, ratios, SCOPE_NAMES, statusLine, utcDate } from '../hooks/format'
import type { Budgets, Scope, Spend } from '../hooks/format'
import { fetchActivity, fetchPrices, priceFor } from '../hooks/litellm'
import type { Prices } from '../hooks/litellm'
import { asMode, setMode, tr } from '../hooks/mode'
import { fill, packById, pickLine, voice } from '../hooks/packs'
import { allowToday, connFromConfig, fetchLite, PROVIDER, readBlocked } from './shared'

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

const tui: TuiPlugin = async (api, options) => {
  const conn = connFromConfig(api.state.config)
  if (!conn) return // not a LiteLLM setup: stay silent, like the Claude Code plugin

  const num = (key: string, fallback: number) => (Number.isFinite(Number(options?.[key])) && options?.[key] !== undefined ? Number(options[key]) : fallback)
  const budgets: Budgets = { session: num('sessionBudget', 20), daily: num('dailyBudget', 60), monthly: num('monthlyBudget', 800) }
  const expensiveTurn = num('expensiveTurn', 1)
  const hufRate = num('hufRate', 350)
  const isFun = options?.fun !== false
  setMode(asMode(options?.mode) ?? 'frugalitas')
  const cacheTtl = cacheTtlMs(options?.promptCacheTtl ?? process.env.CLAUDE_CODE_PROMPT_CACHE_TTL)
  const pack = () => packById(undefined)
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

  api.slots.register({
    slots: {
      session_prompt_right(_ctx, props) {
        return <text>{line(props.session_id)}</text>
      },
    },
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: 'frugal.report',
        title: 'Frugalitas: spend',
        category: 'Plugin',
        namespace: 'palette',
        slashName: 'frugal',
        run() {
          api.ui.toast({ title: 'Frugalitas', message: `today ${money(today() ?? 0)} · month ${money(month() ?? 0)}`, variant: 'info' })
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
