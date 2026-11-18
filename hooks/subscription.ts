// Subscription mode: no LiteLLM proxy, so no billed numbers. Every turn's tokens are weighted by
// what each kind costs relative to plain input (a subscription's limits drain in about those
// proportions) and added to a local ledger of hourly buckets, shared by every session through the
// plugin store. The 5 h window and the week are read back from it.
import { addMetrics, emptyMetrics } from './litellm'
import type { Activity, Day, Metrics, Prices } from './litellm'

export const HOUR_MS = 3_600_000
export const WINDOW_HOURS = 5
export const WEEK_HOURS = 7 * 24
const KEY = 'tok:'

/** Relative prices: output 5×, cache read 0.1×, cache write 1.25× (2× for the 1 h cache), in input-token units. */
export const unitPrices = (isHourCache: boolean): Prices => ({
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheWrite: isHourCache ? 2 : 1.25,
})

const per = (input: number, output: number, cacheRead: number): Prices => ({
  input: input / 1e6,
  output: output / 1e6,
  cacheRead: cacheRead / 1e6,
  cacheWrite: (input * 1.25) / 1e6,
})

// Anthropic API list prices, USD per MTok (input, output, cache read; 5 min cache write = 1.25× input, 1 h = 2×).
// Most specific first; a bare family name ("opus") means the newest. Cache reads of models whose price was not
// published with the rest are 0.1× input.
const API_PRICES: [RegExp, Prices][] = [
  [/(fable|mythos)-5-?2/, per(8, 40, 0.2)],
  [/fable|mythos/, per(10, 50, 0.25)],
  [/opus-4-[01]\b|opus-4$|opus-3/, per(15, 75, 1.5)],
  [/opus-5-?5|^(claude-)?opus$/, per(4, 20, 0.2)],
  [/opus/, per(5, 25, 0.5)],
  [/sonnet-5-?5|^(claude-)?sonnet$/, per(2, 10, 0.1)],
  [/sonnet-5/, per(2, 10, 0.2)],
  [/sonnet/, per(3, 15, 0.3)],
  [/haiku-5|^(claude-)?haiku$/, per(0.1, 0.5, 0.01)],
  [/haiku-4/, per(1, 5, 0.1)],
  [/haiku/, per(0.8, 4, 0.08)],
]

/** A price with the 1 h cache write spelled out, when the source has it. */
export type ApiPrice = Prices & { cacheWrite1h?: number }

// Live prices (LiteLLM's public price file), when loaded; the table above is the fallback.
let live: Record<string, ApiPrice> = {}

const normalized = (model: string) =>
  model.toLowerCase().replace(/^.*\//, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')

/** What the API would bill per token for a model (as Claude Code names it), when known. */
export const apiPriceFor = (model: string): ApiPrice | undefined => {
  const name = normalized(model)
  return live[name] ?? API_PRICES.find(([re]) => re.test(name))?.[1]
}

/** What the API would have billed for a turn's tokens. */
export function apiCost(u: Usage, p: ApiPrice, isHourCache: boolean): number {
  const write = isHourCache ? (p.cacheWrite1h ?? p.cacheWrite * 1.6) : p.cacheWrite
  return u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * write
}

export const PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const PRICES_KEY = 'prices:anthropic'
const PRICES_FRESH_MS = 24 * HOUR_MS

/** The Claude entries of LiteLLM's price file (USD per token), keyed by model id without date suffix. */
export function parsePrices(json: unknown): Record<string, ApiPrice> {
  const out: Record<string, ApiPrice> = {}
  for (const [key, v] of Object.entries((json ?? {}) as Record<string, any>)) {
    if (!/^claude-/.test(key) || key.includes('/') || key.includes(':')) continue
    const input = Number(v?.input_cost_per_token)
    const output = Number(v?.output_cost_per_token)
    if (!(input > 0) || !(output > 0)) continue
    const write1h = Number(v?.cache_creation_input_token_cost_above_1hr)
    out[normalized(key)] = {
      input,
      output,
      cacheRead: Number(v?.cache_read_input_token_cost ?? input * 0.1),
      cacheWrite: Number(v?.cache_creation_input_token_cost ?? input * 1.25),
      ...(write1h > 0 ? { cacheWrite1h: write1h } : {}),
    }
  }
  return out
}

export const setLivePrices = (prices: Record<string, ApiPrice>): void => {
  live = prices
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

/** Live prices from the store (up to a day old) or the network; a failure keeps the stale copy, or the built-in table. */
export async function loadLivePrices(store: Store, fetch: Fetcher, now: number): Promise<'cached' | 'fetched' | 'stale' | 'builtin'> {
  const kept = (await store.get(PRICES_KEY)) as { at: number; prices?: Record<string, ApiPrice> } | undefined
  const has = kept?.prices && Object.keys(kept.prices).length > 0
  if (has && now - kept.at < PRICES_FRESH_MS) {
    live = kept.prices!
    return 'cached'
  }
  try {
    const res = await fetch(PRICES_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const prices = parsePrices(JSON.parse(res.text))
    if (Object.keys(prices).length === 0) throw new Error('no Claude prices in the file')
    live = prices
    await store.set(PRICES_KEY, { at: now, prices })
    return 'fetched'
  } catch {
    if (has) {
      live = kept.prices!
      return 'stale'
    }
    return 'builtin'
  }
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** `usd`: what the API would have billed for the model's turns in this hour. */
type Bucket = { at: number; models: Record<string, Metrics>; usd?: Record<string, number> }

export type Store = {
  get: (key: string) => Promise<{ at: number; [k: string]: unknown } | undefined>
  set: (key: string, value: { at: number; [k: string]: unknown }) => Promise<void>
  keys: () => Promise<string[]>
}

const hourOf = (ms: number) => Math.floor(ms / HOUR_MS)
const keyOf = (hour: number) => `${KEY}${new Date(hour * HOUR_MS).toISOString().slice(0, 13)}`
const hourFromKey = (key: string) => Date.parse(`${key.slice(KEY.length)}:00:00Z`) / HOUR_MS

/** Adds one turn to its hour's bucket (read-modify-write: two sessions in the same instant may lose one turn). */
export async function recordUsage(store: Store, now: number, model: string, usage: Usage, weighted: number, usd = 0): Promise<void> {
  const key = keyOf(hourOf(now))
  const bucket = ((await store.get(key)) as Bucket | undefined) ?? { at: now, models: {} }
  const m = bucket.models[model] ?? emptyMetrics()
  bucket.models[model] = addMetrics(m, {
    ...emptyMetrics(),
    spend: weighted,
    promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completionTokens: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    requests: 1,
  })
  bucket.usd = { ...bucket.usd, [model]: (bucket.usd?.[model] ?? 0) + usd }
  bucket.at = now
  await store.set(key, bucket)
}

/** API-equivalent dollars, in the scopes the ledger is read in. */
export type ApiCost = { window: number; week: number; total: number; days: Record<string, number>; models: Record<string, number> }

export type Local = { activity: Activity; window: number; week: number; api: ApiCost }

/** Everything kept in the ledger as UTC days, plus the rolling 5 h window and 7 days. */
export async function loadLocal(store: Store, now: number): Promise<Local> {
  const nowHour = hourOf(now)
  const byDate = new Map<string, Day>()
  let total = emptyMetrics()
  let window = 0
  let week = 0
  const api: ApiCost = { window: 0, week: 0, total: 0, days: {}, models: {} }
  for (const key of (await store.keys()).filter(k => k.startsWith(KEY))) {
    const bucket = (await store.get(key)) as Bucket | undefined
    const hour = hourFromKey(key)
    if (!bucket?.models || Number.isNaN(hour)) continue
    const date = key.slice(KEY.length, KEY.length + 10)
    const age = nowHour - hour
    for (const [name, usd] of Object.entries(bucket.usd ?? {})) {
      api.total += usd
      api.days[date] = (api.days[date] ?? 0) + usd
      api.models[name] = (api.models[name] ?? 0) + usd
      if (age < WINDOW_HOURS) api.window += usd
      if (age < WEEK_HOURS) api.week += usd
    }
    const day = byDate.get(date) ?? { date, metrics: emptyMetrics(), models: {} }
    byDate.set(date, day)
    for (const [name, m] of Object.entries(bucket.models)) {
      day.metrics = addMetrics(day.metrics, m)
      day.models[name] = addMetrics(day.models[name] ?? emptyMetrics(), m)
      total = addMetrics(total, m)
      if (age < WINDOW_HOURS) window += m.spend
      if (age < WEEK_HOURS) week += m.spend
    }
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { activity: { days, total }, window, week, api }
}

/** The models a subscription session may use, at API prices: what restart/compact cost estimates choose from. */
export const apiModels = (): Record<string, Prices> =>
  Object.fromEntries(
    ['claude-fable-5-2', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-haiku-5-5', 'claude-haiku-4-5'].flatMap(id => {
      const price = apiPriceFor(id)
      return price ? [[id, price]] : []
    }),
  )
