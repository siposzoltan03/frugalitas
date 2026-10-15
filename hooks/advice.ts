import { money } from './format'
import type { Day, Prices } from './litellm'

// Savings advice beyond the daily tips in format.ts: what the session itself shows
// (an expired cache, a fat context, big tool outputs, subagents, a /compact's effect)
// and what LiteLLM's history shows (forecast, output share, failures, weekdays).
// Every function returns undefined when there is nothing worth saying.

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

/** The prompt cache lives five minutes; past that the next turn writes the whole context again. */
export const CACHE_TTL_MS = 5 * 60_000

/** The session's cache lifetime: `promptCacheTtl` / CLAUDE_CODE_PROMPT_CACHE_TTL is "5m" or "1h". */
export function cacheTtlMs(setting: unknown): number {
  return setting === '1h' ? 60 * 60_000 : CACHE_TTL_MS
}

/** `3:42`, or `0:07`. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The status line's cache part: counting down after a turn, then expired. */
export function cacheStatus(remainingMs: number): string {
  if (remainingMs <= 0) return '❄️ cache expired'
  return remainingMs <= 60_000 ? `⌛ cache ${clock(remainingMs)}!` : `⏳ cache ${clock(remainingMs)}`
}

/** Tokens a /compact summary comes to, roughly. */
export const SUMMARY_TOKENS = 8_000

/** How far ahead the keep / compact / clear comparison looks. */
export const RESTART_TURNS = 10

export type RestartCosts = { keep: number; compact: number; clear: number; best: 'keep' | 'compact' }

/**
 * What the next `turns` turns cost if you keep the context, /compact it first, or /clear.
 * The first turn (or the compaction) reads the context at cache-read price while the cache
 * is warm and rewrites it at cache-write price once it has expired; every later turn reads
 * what is left. `baseTokens` is what a fresh session starts with (system prompt, tools).
 */
export function restartCosts(
  contextTokens: number,
  baseTokens: number,
  price: Prices,
  isWarm: boolean,
  turns = RESTART_TURNS,
): RestartCosts {
  const base = Math.min(Math.max(baseTokens, 10_000), contextTokens)
  const first = isWarm ? price.cacheRead : price.cacheWrite
  const after = base + SUMMARY_TOKENS
  const keep = contextTokens * first + (turns - 1) * contextTokens * price.cacheRead
  const compact =
    contextTokens * first + SUMMARY_TOKENS * price.output + after * price.cacheWrite + (turns - 1) * after * price.cacheRead
  const clear = base * price.cacheWrite + (turns - 1) * base * price.cacheRead
  return { keep, compact, clear, best: compact < keep * 0.9 ? 'compact' : 'keep' }
}

/** Once the cache has expired: keep going, /compact or /clear, priced for the next turns. */
export function clearOrRewriteTip(contextTokens: number, baseTokens: number, price: Prices | undefined): string | undefined {
  if (!price || contextTokens < 50_000) return undefined
  const c = restartCosts(contextTokens, baseTokens, price, false)
  const same = c.best === 'compact' ? '/compact' : 'just keep going'
  return (
    `🤔 The cache expired (${k(contextTokens)} context). The next ${RESTART_TURNS} turns cost: ` +
    `keep going ~${money(c.keep)} · /compact ~${money(c.compact)} · /clear ~${money(c.clear)}. ` +
    `Same task: ${same}; new task: /clear.`
  )
}

/** Said ~30 s before the cache expires, while sending now (or compacting now) still reads it cheaply. */
export function cacheSoonWarning(remainingMs: number, contextTokens: number, price: Prices | undefined): string | undefined {
  if (remainingMs <= 0 || remainingMs > 30_000 || contextTokens < 50_000) return undefined
  const cost = price ? ` ≈ ${money(contextTokens * price.cacheWrite)}` : ''
  const compactNow = price ? ` (~${money(contextTokens * price.cacheRead + SUMMARY_TOKENS * price.output)} while it's warm)` : ''
  return `⏳ The cache expires in ${Math.ceil(remainingMs / 1000)} s: rewriting ${k(contextTokens)} tokens would cost${cost || ' extra'}. Send now, or /compact now${compactNow}.`
}

export function cacheExpiryWarning(
  idleMs: number,
  contextTokens: number,
  price: Prices | undefined,
  ttlMs = CACHE_TTL_MS,
): string | undefined {
  if (idleMs < ttlMs || contextTokens < 50_000) return undefined
  const minutes = Math.round(idleMs / 60_000)
  const cost = price ? ` ≈ ${money(contextTokens * price.cacheWrite)}` : ''
  return `⏳ ${minutes} min break: the cache expired, this turn rewrites ${k(contextTokens)} tokens${cost}. /compact first?`
}

/** Every turn reads the whole context from the cache at least once. */
export function contextGrowthTip(contextTokens: number, price: Prices | undefined): string | undefined {
  if (contextTokens < 250_000) return undefined
  const perTurn = price ? `, each turn costs ≥ ${money(contextTokens * price.cacheRead)} just to read it` : ''
  return `🐘 The context is ${k(contextTokens)} tokens${perTurn}. /compact, or /clear for a new task.`
}

/** Roughly four characters a token. */
export const tokensOfText = (chars: number) => Math.round(chars / 4)

export function toolOutputTip(tool: string, what: string, chars: number): string | undefined {
  const tokens = tokensOfText(chars)
  if (tokens < 15_000) return undefined
  const hint =
    tool === 'Bash' ? 'next time `| tail -50` or `| grep`' : tool === 'Read' ? 'next time use offset/limit, or search for it' : 'narrow the request'
  return `📦 The ${tool} output ${what ? `(${what}) ` : ''}was ~${k(tokens)} tokens — ${hint}.`
}

export function repeatReadTip(path: string, count: number): string | undefined {
  if (count < 4) return undefined
  const name = path.replace(/^.*\//, '')
  return `🔁 ${name} has been read ${count}× this session. Ask Claude to keep the relevant part in mind instead.`
}

export function subagentTip(mainTokens: number, subTokens: number): string | undefined {
  const total = mainTokens + subTokens
  if (subTokens < 1_000_000 || total === 0 || subTokens / total < 0.4) return undefined
  return `🤖 Subagents used ${Math.round((subTokens / total) * 100)}% of this session's tokens. Small tasks don't need them.`
}

export function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Month-end spend at the pace of the closed days so far (today counts as half a day). */
export function forecast(monthSpend: number, date: string): number {
  const day = Number(date.slice(8))
  const elapsed = Math.max(0.5, day - 0.5)
  return (monthSpend / elapsed) * daysInMonth(date)
}

export function forecastTip(monthSpend: number, date: string, monthlyBudget: number): string | undefined {
  if (Number(date.slice(8)) < 3 || monthSpend <= 0) return undefined
  const end = forecast(monthSpend, date)
  if (monthlyBudget > 0 && monthSpend >= monthlyBudget) {
    return `📈 The monthly budget is already spent (${money(monthSpend)}/${money(monthlyBudget)}); at this pace the month ends at ~${money(end)}.`
  }
  if (monthlyBudget > 0 && end > monthlyBudget) {
    const daysLeft = daysInMonth(date) - Number(date.slice(8)) + 1
    const perDay = Math.max(0, monthlyBudget - monthSpend) / daysLeft
    return `📈 At this pace the month ends at ~${money(end)} (budget ${money(monthlyBudget)}). To fit: ~${money(perDay)}/day.`
  }
  return `📊 At this pace the month ends at ~${money(end)}${monthlyBudget > 0 ? ` (budget ${money(monthlyBudget)})` : ''}.`
}

/** What the day's output tokens cost, priced per model. */
export function outputShare(day: Day, prices: (model: string) => Prices | undefined): number {
  let output = 0
  for (const [model, m] of Object.entries(day.models)) output += m.completionTokens * (prices(model)?.output ?? 0)
  return day.metrics.spend > 0 ? output / day.metrics.spend : 0
}

export function outputTip(day: Day | undefined, prices: (model: string) => Prices | undefined): string | undefined {
  if (!day || day.metrics.spend < 2) return undefined
  const share = outputShare(day, prices)
  if (share < 0.35) return undefined
  return `✍️ ${Math.round(share * 100)}% of the spend is output tokens (5× the price of input). Ask for terser answers and diffs, not whole files.`
}

export function failedTip(day: Day | undefined): string | undefined {
  if (!day) return undefined
  const { failed, requests } = day.metrics
  if (failed < 3 || failed / Math.max(1, requests) < 0.02) return undefined
  return `⚠️ ${failed} requests failed (${Math.round((failed / requests) * 100)}%). Retries cost too — check what keeps failing.`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The weekday whose active days cost markedly more than the rest, over at least three weeks of history. */
export function weekdayTip(days: readonly Day[]): string | undefined {
  const active = days.filter(d => d.metrics.spend > 0)
  if (active.length < 10) return undefined
  const span = (Date.parse(active.at(-1)!.date) - Date.parse(active[0]!.date)) / 86_400_000
  if (span < 21) return undefined
  const sums = new Map<number, { spend: number; n: number }>()
  for (const d of active) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay()
    const s = sums.get(wd) ?? { spend: 0, n: 0 }
    sums.set(wd, { spend: s.spend + d.metrics.spend, n: s.n + 1 })
  }
  const avg = active.reduce((n, d) => n + d.metrics.spend, 0) / active.length
  const [wd, top] = [...sums].filter(([, s]) => s.n >= 2).sort((a, b) => b[1].spend / b[1].n - a[1].spend / a[1].n)[0] ?? []
  if (wd === undefined || !top || top.spend / top.n < avg * 1.5) return undefined
  return `📅 ${WEEKDAYS[wd]}s are your dearest days (average ${money(top.spend / top.n)}, the rest ${money(avg)}).`
}

/** Tokens a turn moved, weighted by what each kind costs relative to plain input. */
export function weightedTokens(u: { input: number; output: number; cacheRead: number; cacheWrite: number }, p: Prices): number {
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / p.input
}

/** After a /compact: how much cheaper the turns got, once three turns on each side are known. */
export function compactEffectTip(before: readonly number[], after: readonly number[]): string | undefined {
  if (before.length < 3 || after.length < 3) return undefined
  const avg = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0) / xs.length
  const drop = 1 - avg(after.slice(0, 3)) / avg(before.slice(-3))
  if (drop < 0.1) return undefined
  return `✂️ Since the /compact your turns are ~${Math.round(drop * 100)}% cheaper. Worth it!`
}

// --- Daily quests ---------------------------------------------------------------

export type Quest = { id: string; text: string; done: (day: Day, dailyBudget: number) => boolean }

const opusShare = (d: Day) => {
  const opus = Object.entries(d.models).filter(([n]) => /opus/i.test(n)).reduce((n, [, m]) => n + m.spend, 0)
  return d.metrics.spend > 0 ? opus / d.metrics.spend : 0
}
const cacheHit = (d: Day) => (d.metrics.promptTokens > 0 ? d.metrics.cacheRead / d.metrics.promptTokens : 0)
const modelsUsed = (d: Day) => Object.values(d.models).filter(m => m.spend > 0.05).length

export const QUEST_XP = 5

export const QUESTS: readonly Quest[] = [
  { id: 'opus', text: 'keep Opus under 50% of the spend', done: d => opusShare(d) < 0.5 },
  { id: 'cache', text: 'keep the cache hit above 85%', done: d => cacheHit(d) >= 0.85 },
  { id: 'half', text: 'spend less than half the daily budget', done: (d, b) => b > 0 && d.metrics.spend <= b / 2 },
  { id: 'models', text: 'use at most 2 models', done: d => modelsUsed(d) <= 2 },
  { id: 'errors', text: 'have zero failed requests', done: d => d.metrics.failed === 0 },
]

/** The day's quest, the same for everyone on that day. */
export function questFor(date: string): Quest {
  const n = [...date].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  return QUESTS[n % QUESTS.length]!
}
