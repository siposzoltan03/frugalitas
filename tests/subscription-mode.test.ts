import { describe, expect, test } from 'claude-code/testing'

import { amount, limitsText, money, resetIn, setUnit, statusLine } from '../hooks/format'
import { apiCost, apiPriceFor, loadLivePrices, loadLocal, parsePrices, recordUsage, setLivePrices, unitPrices } from '../hooks/subscription'
import { weightedTokens } from '../hooks/advice'

const memory = () => {
  const data = new Map<string, { at: number; [k: string]: unknown }>()
  return {
    get: async (k: string) => data.get(k),
    set: async (k: string, v: { at: number; [k: string]: unknown }) => void data.set(k, v),
    keys: async () => [...data.keys()],
  }
}

const usage = { input: 1000, output: 100, cacheRead: 10_000, cacheWrite: 800 }

const priceFile = {
  'claude-opus-5-5': { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6, cache_read_input_token_cost: 3e-7, cache_creation_input_token_cost: 3.75e-6, cache_creation_input_token_cost_above_1hr: 6e-6 },
  'claude-sonnet-4-5-20250929': { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6 },
  'azure_ai/claude-opus-4-8': { input_cost_per_token: 1, output_cost_per_token: 1 },
  'gpt-4': { input_cost_per_token: 1, output_cost_per_token: 1 },
}

describe('live API prices', () => {
  test('only Claude entries are kept, without date suffixes', () => {
    const prices = parsePrices(priceFile)
    expect(Object.keys(prices).sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-4-5'])
    expect(prices['claude-opus-5-5']!.cacheWrite1h).toBe(6e-6)
    expect(Math.round(prices['claude-sonnet-4-5']!.cacheRead * 1e9)).toBe(300)
  })

  test('live prices win over the table, and the 1 h write uses its own price', () => {
    setLivePrices(parsePrices(priceFile))
    try {
      expect(apiPriceFor('claude-opus-5-5[1m]')!.input).toBe(3e-6)
      expect(apiPriceFor('claude-sonnet-4-5-20250929')!.output).toBe(15e-6)
      const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }
      expect(Math.round(apiCost(u, apiPriceFor('claude-opus-5-5')!, false) * 100)).toBe(375)
      expect(Math.round(apiCost(u, apiPriceFor('claude-opus-5-5')!, true) * 100)).toBe(600)
    } finally {
      setLivePrices({})
    }
  })

  test('fetched once a day, stale copy kept on failure, built-in table without either', async () => {
    const store = memory()
    let calls = 0
    const ok = async () => (calls++, { ok: true, status: 200, text: JSON.stringify(priceFile) })
    const down = async () => { throw new Error('offline') }
    try {
      expect(await loadLivePrices(store, down, 1000)).toBe('builtin')
      expect(await loadLivePrices(store, ok, 1000)).toBe('fetched')
      expect(await loadLivePrices(store, ok, 2000)).toBe('cached')
      expect(calls).toBe(1)
      expect(await loadLivePrices(store, down, 1000 + 25 * 3_600_000)).toBe('stale')
    } finally {
      setLivePrices({})
    }
  })
})

describe('subscription limits', () => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  test('time until a window resets', () => {
    expect(resetIn('2026-11-18T14:14:00Z', now)).toBe('2h14m')
    expect(resetIn('2026-11-18T12:38:00Z', now)).toBe('38m')
    expect(resetIn('2026-11-22T16:00:00Z', now)).toBe('4d4h')
    expect(resetIn('2026-11-18T11:00:00Z', now)).toBe('')
    expect(resetIn(undefined, now)).toBe('')
  })

  test('limits read as one line, in the status line too', () => {
    const limits = [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-18T14:14:00Z' },
      { kind: 'seven_day', percentUsed: 7 },
    ]
    expect(limitsText(limits, now)).toBe('5h 24% ↻2h14m · 7d 7%')
    expect(statusLine({ session: 0, today: 0, month: 0 }, { session: 0, daily: 0, monthly: 0 }, false, false, undefined, limitsText(limits, now))).toContain('⏱ 5h 24%')
  })
})

describe('subscription mode', () => {
  test('API list prices by model name', () => {
    expect(Math.round(apiPriceFor('claude-opus-5-5[1m]')!.output * 1e8)).toBe(Math.round(20 * 100))
    expect(Math.round(apiPriceFor('opus')!.input * 1e8)).toBe(Math.round(4 * 100))
    expect(Math.round(apiPriceFor('claude-opus-4-8')!.output * 1e8)).toBe(Math.round(25 * 100))
    expect(Math.round(apiPriceFor('claude-opus-4-1')!.input * 1e8)).toBe(Math.round(15 * 100))
    expect(Math.round(apiPriceFor('claude-sonnet-5-5')!.cacheRead * 1e8)).toBe(Math.round(0.1 * 100))
    expect(Math.round(apiPriceFor('claude-sonnet-4-6')!.input * 1e8)).toBe(Math.round(3 * 100))
    expect(Math.round(apiPriceFor('claude-haiku-4-5')!.output * 1e8)).toBe(Math.round(5 * 100))
    expect(Math.round(apiPriceFor('claude-fable-5-2')!.input * 1e8)).toBe(Math.round(8 * 100))
    expect(apiPriceFor('gpt-4')).toBeUndefined()
  })

  test('the ledger keeps API-equivalent dollars per window, week, day and model', async () => {
    const store = memory()
    const now = Date.parse('2026-11-18T12:30:00Z')
    await recordUsage(store, now, 'opus', usage, 100, 2)
    await recordUsage(store, now - 6 * 3_600_000, 'sonnet', usage, 1, 0.5)
    await recordUsage(store, now - 9 * 86_400_000, 'opus', usage, 1, 10)
    const { api } = await loadLocal(store, now)
    expect(api.window).toBe(2)
    expect(api.week).toBe(2.5)
    expect(api.total).toBe(12.5)
    expect(api.days['2026-11-18']).toBe(2.5)
    expect(api.models.opus).toBe(12)
  })

  test('tokens are weighted by relative price', () => {
    expect(weightedTokens(usage, unitPrices(false))).toBe(1000 + 500 + 1000 + 1000)
    expect(weightedTokens({ ...usage, cacheWrite: 100 }, unitPrices(true))).toBe(1000 + 500 + 1000 + 200)
  })

  test('the ledger gives the 5 h window, the week and the days', async () => {
    const store = memory()
    const now = Date.parse('2026-11-18T12:30:00Z')
    await recordUsage(store, now, 'opus', usage, 100)
    await recordUsage(store, now - 3 * 3_600_000, 'opus', usage, 10) // 09:xx: inside the window
    await recordUsage(store, now - 6 * 3_600_000, 'sonnet', usage, 1) // 06:xx: outside it
    await recordUsage(store, now - 3 * 86_400_000, 'opus', usage, 1000) // inside the week
    await recordUsage(store, now - 9 * 86_400_000, 'opus', usage, 10_000) // outside it
    const local = await loadLocal(store, now)
    expect(local.window).toBe(110)
    expect(local.week).toBe(111 + 1000)
    expect(local.activity.days.map(d => d.date)).toEqual(['2026-11-09', '2026-11-15', '2026-11-18'])
    expect(local.activity.days.at(-1)!.metrics.requests).toBe(3)
  })

  test('amounts read as tokens, not dollars', () => {
    setUnit('tokens')
    try {
      expect(amount(340_000)).toBe('340k')
      expect(money(2.5)).toBe('$2.50')
      expect(amount(1_250_000)).toBe('1.3M')
      expect(statusLine({ session: 200_000, today: 3_000_000, month: 20_000_000 }, { session: 1e6, daily: 5e6, monthly: 0 }, false, false)).toBe(
        'frugal session 200k/1.0M · 5h 3.0M/5.0M · week 20M',
      )
    } finally {
      setUnit('usd')
    }
  })
})
