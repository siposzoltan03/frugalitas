import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { inKind, mood, statusLine, streak, tips } from '../hooks/format'
import { makeConn, parseCustomHeaders, priceFor } from '../hooks/litellm'
import { MASCOT_COLUMNS, MASCOT_PIXEL_ROWS, MASCOT_ROWS, mascotMood, mascotPixels, mascotRasterCells } from '../hooks/mascot'
import { fill, PACKS, packById, voice } from '../hooks/packs'
import { SKINS, skinById } from '../hooks/skins'
import { balance, buy, credit, creditFrom, dayXp, newLedger, rankOf, wear } from '../hooks/xp'
import type { ShopItem } from '../hooks/xp'
import type { Day, Prices } from '../hooks/litellm'
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
  forecast,
  forecastTip,
  outputTip,
  QUESTS,
  questFor,
  repeatReadTip,
  subagentTip,
  toolOutputTip,
  weekdayTip,
} from '../hooks/advice'

const NOW = Date.parse('2026-10-13T12:00:00Z')

const metrics = (spend: number, extra: Record<string, number> = {}) => ({
  spend,
  prompt_tokens: 1_000_000,
  completion_tokens: 10_000,
  cache_read_input_tokens: 900_000,
  cache_creation_input_tokens: 50_000,
  prompt_caching_savings_spend: spend * 4,
  api_requests: 10,
  ...extra,
})

const day = (date: string, spend: number) => ({
  date,
  metrics: metrics(spend),
  breakdown: { models: { 'azure_ai/claude-opus-5-5': { metrics: metrics(spend) } } },
})

/** A LiteLLM proxy: key spend moves by `keySpend()`, the month holds the given days. */
function proxy(on: On, keySpend: () => number, days: { date: string; spend: number }[], seen: string[] = []) {
  on('http.fetch', async ($, e) => {
    seen.push(e.url)
    const headers = e.init?.headers ?? {}
    if (headers.Authorization !== 'Bearer sk-test' || headers['CF-Access-Client-Id'] !== 'cf-id') {
      return { value: { status: 401, ok: false, headers: {}, text: '{"error":{"message":"nope"}}' } }
    }
    const url = new URL(e.url)
    if (url.pathname === '/key/info') {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ info: { spend: keySpend() } }) } }
    }
    const start = url.searchParams.get('start_date')!
    const end = url.searchParams.get('end_date')!
    const inRange = days.filter(d => d.date >= start && d.date <= end)
    const total = inRange.reduce((n, d) => n + d.spend, 0)
    const text = JSON.stringify({
      results: inRange.map(d => day(d.date, d.spend)).reverse(),
      metadata: { ...Object.fromEntries(Object.entries(metrics(total)).map(([k, v]) => [`total_${k}`, v])), total_spend: total, has_more: false },
    })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

/** What the engine itself would answer beneath the plugin. */
function engine(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('ui.log', () => ({ value: undefined }))
}

function world(on: On) {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, {
    ANTHROPIC_BASE_URL: 'https://litellm.example.com/',
    ANTHROPIC_AUTH_TOKEN: 'sk-test',
    ANTHROPIC_CUSTOM_HEADERS: 'CF-Access-Client-Id: cf-id\nCF-Access-Client-Secret: cf-secret',
  })
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  return { statuses, toasts }
}

const COMMAND = (args: string) =>
  ({ command: 'penny', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

describe('pure parts', () => {
  test('custom headers and the connection', async () => {
    expect(parseCustomHeaders('A: 1\nB:  two words \n\nbroken')).toEqual({ A: '1', B: 'two words' })
    expect(makeConn({ baseUrl: 'https://api.anthropic.com', authToken: 'x' })).toBeUndefined()
    expect(makeConn({ authToken: 'x' })).toBeUndefined()
    expect(makeConn({ baseUrl: 'https://l.example/', apiKey: 'k', customHeaders: 'X: y' })).toEqual({
      baseUrl: 'https://l.example',
      headers: { X: 'y', Authorization: 'Bearer k' },
    })
  })

  test('mood, status line and what it buys', async () => {
    expect(mood(0.2)).toBe('😇')
    expect(mood(0.95)).toBe('🥵')
    expect(mood(2)).toBe('💀')
    const line = statusLine({ session: 1.5, today: 45, month: 300 }, { session: 20, daily: 60, monthly: 800 }, true, false)
    expect(line).toBe('🪙 😬 session ~$1.50/$20.00 · today $45.00/$60.00 · month $300/$800')
    expect(inKind(4)).toBe('≈ 1 coffee ☕')
    expect(inKind(1000)).toBe('≈ 1.7 weekend city breaks 🧳')
  })

  test('streak counts days within budget up to yesterday', async () => {
    const d = (date: string, spend: number) => ({ date, metrics: { spend } }) as unknown as Day
    const days = [d('2026-10-05', 90), d('2026-10-08', 10), d('2026-10-12', 20), d('2026-10-13', 99)]
    expect(streak(days, '2026-10-13', 60)).toBe(7)
  })

  test('tips rest on the numbers', async () => {
    const today: Day = {
      date: '2026-10-13',
      metrics: { spend: 20, promptTokens: 3e6, completionTokens: 1e4, cacheRead: 1e6, cacheWrite: 0, cacheSaved: 0, requests: 1, failed: 0 },
      models: {
        'azure_ai/claude-opus-5-5': { spend: 19, promptTokens: 1e6, completionTokens: 0, cacheRead: 0, cacheWrite: 0, cacheSaved: 0, requests: 1, failed: 0 },
        'azure_ai/claude-sonnet-5-5': { spend: 1, promptTokens: 2e5, completionTokens: 0, cacheRead: 0, cacheWrite: 0, cacheSaved: 0, requests: 1, failed: 0 },
      },
    }
    const out = tips(today, 200_000)
    expect(out.length).toBe(3)
    expect(out[2]).toContain('3.8x dearer')
  })
})

describe('in a session', () => {
  test('status line from the proxy, then the monthly report', async ($, on) => {
    const { statuses } = world(on)
    let spend = 100
    const seen: string[] = []
    proxy(on, () => spend, [{ date: '2026-10-01', spend: 30 }, { date: '2026-10-13', spend: 12 }], seen)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    spend = 103.25
    const text = (await $.command.run(COMMAND(''))).text ?? ''

    expect(seen[0]).toContain('https://litellm.example.com/')
    expect(statuses.at(-1)).toBe('🪙 😇 session ~$3.25/$20.00 · today $12.00/$60.00 · month $42.00/$800')
    expect(text).toContain('🪙 Penny Pincher – 2026-10')
    expect(text).toContain('claude-opus-5-5')
    expect(text).toContain('Total: $42.00')
  })

  test('block mode drops prompts over budget until /penny allow', { options: { overBudget: 'block', dailyBudget: 10 } }, async ($, on) => {
    const { toasts } = world(on)
    proxy(on, () => 5, [{ date: '2026-10-13', spend: 12 }])
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run(COMMAND('refresh'))

    expect(toasts.some(t => t.includes('daily'))).toBe(true)
    const dropped = await $.prompt.submit({ text: 'szia', wait: false, origin: { kind: 'composer' } })
    expect(dropped.drop).toContain('daily budget')

    await $.command.run(COMMAND('allow'))
    const passed = await $.prompt.submit({ text: 'szia', wait: false, origin: { kind: 'composer' } })
    expect(passed.drop).toBeUndefined()
  })

  test('silent without a LiteLLM proxy', async ($, on) => {
    engine(on)
    mock.clock(on, { now: NOW })
    mock.store(on)
    mock.env(on, {})
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(COMMAND(''))).text).toContain('not running through a LiteLLM')
  })
})

describe('mascot', () => {
  test('every skin in every mood is a full sprite of its own colors', async () => {
    for (const skin of SKINS) {
      expect(skin.rows.length).toBe(MASCOT_PIXEL_ROWS)
      for (const m of ['calm', 'worried', 'angry'] as const) {
        const rows = mascotPixels(skin, m)
        for (const row of rows) {
          expect(row.length).toBe(MASCOT_COLUMNS)
          for (const ch of row) if (ch !== '.') expect(skin.palette[ch]).toBeDefined()
        }
        expect(atob(mascotRasterCells(skin, m)).length).toBe(MASCOT_COLUMNS * MASCOT_ROWS * 3 * 4)
      }
      expect(mascotPixels(skin, 'worried')).not.toEqual(mascotPixels(skin, 'calm'))
      expect(mascotPixels(skin, 'angry')).not.toEqual(mascotPixels(skin, 'calm'))
    }
    expect(new Set(SKINS.map(s => s.id)).size).toBe(SKINS.length)
    expect(skinById('no such skin').id).toBe('miser')
  })

  test('mood follows the worst budget', async () => {
    expect(mascotMood(undefined)).toBe('calm')
    expect(mascotMood(0.5)).toBe('calm')
    expect(mascotMood(0.9)).toBe('worried')
    expect(mascotMood(1.2)).toBe('angry')
  })

  test('packs fill their placeholders and have a saying for every mood', async () => {
    for (const p of PACKS) {
      for (const list of [p.warn, p.over, p.turn, p.xp, p.sayings.calm, p.sayings.worried, p.sayings.angry]) {
        expect(list.length).toBeGreaterThan(0)
      }
      const vars = { scope: 'daily', pct: 85, spent: '$30.00', budget: '$25.00', cost: '$1.20', kind: '≈ 1 coffee ☕', xp: 18 }
      for (const t of [...p.warn, ...p.over, ...p.turn, ...p.xp]) expect(fill(t, vars)).not.toContain('{')
    }
    expect(packById('auditor').name).toBe('The Auditor')
  })
})

describe('XP', () => {
  const d = (date: string, spend: number) => ({ date, metrics: { spend } }) as unknown as Day

  test('a thrifty day earns base + thrift + streak; a day over budget earns nothing and breaks the streak', async () => {
    expect(dayXp(0, 25, 0)).toBe(0) // idle
    expect(dayXp(30, 25, 3)).toBe(0) // over
    expect(dayXp(12.5, 25, 0)).toBe(15) // 10 + 5
    expect(dayXp(5, 25, 9)).toBe(10 + 8 + 10) // streak capped at +10

    const start = newLedger('2026-10-14', 0) // since 2026-10-07
    const days = [d('2026-10-05', 1), d('2026-10-07', 20), d('2026-10-08', 10), d('2026-10-09', 40), d('2026-10-12', 5), d('2026-10-14', 1)]
    const { ledger, gained, credited } = credit(start, days, '2026-10-14', 25)
    expect(credited).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']) // not before `since`, not today
    expect(ledger.days).toEqual({ '2026-10-07': 12, '2026-10-08': 18, '2026-10-09': 0, '2026-10-12': 18 })
    const questBonus = Object.values(ledger.quests).reduce((n, xp) => n + xp, 0)
    expect(gained).toBe(48 + questBonus) // days + the quests met on them
    expect(Object.keys(ledger.quests).every(d => ledger.days[d]! > 0)).toBe(true) // never on a day over budget
    expect(creditFrom(ledger)).toBe('2026-10-13')

    // frozen: crediting again with a bigger budget changes nothing
    expect(credit(ledger, days, '2026-10-14', 1000).gained).toBe(0)
  })

  test('shop: spend coins, wear what you own, refuse what you cannot afford', async () => {
    const l = { ...newLedger('2026-10-14', 0), days: { '2026-10-10': 100, '2026-10-11': 60 } }
    const accountant: ShopItem = { kind: 'skin', id: 'accountant', name: 'Bean Counter', description: '', price: 150 }
    const dragon: ShopItem = { kind: 'skin', id: 'dragon', name: 'Hoard Dragon', description: '', price: 300 }

    const bought = buy(l, accountant)
    if (!('ledger' in bought)) throw new Error(bought.error)
    expect(balance(bought.ledger)).toBe(10)
    expect(bought.ledger.skin).toBe('accountant')

    const poor = buy(bought.ledger, dragon)
    expect('error' in poor && poor.error).toContain('290 more to go')

    const again = buy(bought.ledger, accountant)
    expect('error' in again && again.error).toContain('already own') // no second charge

    const unowned = wear(bought.ledger, dragon)
    expect('error' in unowned && unowned.error).toContain('/penny buy dragon') // wearing never buys

    const miser: ShopItem = { kind: 'skin', id: 'miser', name: 'Old Penny', description: '', price: 0 }
    const back = wear(bought.ledger, miser)
    expect('ledger' in back && back.ledger.skin).toBe('miser')
    expect('ledger' in back && balance(back.ledger)).toBe(10)
  })

  test('ranks', async () => {
    expect(rankOf(0).name).toBe('Apprentice Saver')
    expect(rankOf(160).name).toBe('Bean Counter')
    expect(rankOf(250).progress).toBe(0.5)
    expect(rankOf(5000).next).toBeUndefined()
  })
})

describe('advice', () => {
  const opus: Prices = { input: 4e-6, output: 2e-5, cacheRead: 2e-7, cacheWrite: 5e-6 }
  const sonnet: Prices = { input: 2e-6, output: 1e-5, cacheRead: 2e-7, cacheWrite: 2.5e-6 }
  const metrics = (spend: number, extra: Partial<Day['metrics']> = {}) => ({
    spend, promptTokens: 0, completionTokens: 0, cacheRead: 0, cacheWrite: 0, cacheSaved: 0, requests: 10, failed: 0, ...extra,
  })

  test('model prices match however the model is spelled', async () => {
    const prices = { 'claude-opus-5-5': opus, 'claude-sonnet-5-5': sonnet }
    expect(priceFor(prices, 'azure_ai/claude-opus-5-5')).toEqual(opus)
    expect(priceFor(prices, 'claude-opus-5-5[1m]')).toEqual(opus)
    expect(priceFor(prices, 'sonnet')).toEqual(sonnet)
    expect(priceFor(prices, 'gpt-4o')).toBeUndefined()
  })

  test('session tips: expired cache, fat context, big outputs, rereads, subagents', async () => {
    expect(cacheExpiryWarning(4 * 60_000, 300_000, opus)).toBeUndefined() // still warm
    expect(cacheExpiryWarning(8 * 60_000, 20_000, opus)).toBeUndefined() // small context
    expect(cacheExpiryWarning(8 * 60_000, 300_000, opus)).toContain('rewrites 300k tokens ≈ $1.50')
    expect(contextGrowthTip(200_000, opus)).toBeUndefined()
    expect(contextGrowthTip(400_000, opus)).toContain('≥ $0.08')
    expect(toolOutputTip('Bash', 'npm test', 40_000)).toBeUndefined()
    expect(toolOutputTip('Bash', 'npm test', 160_000)).toContain('~40k tokens')
    expect(repeatReadTip('/a/b/register.tsx', 3)).toBeUndefined()
    expect(repeatReadTip('/a/b/register.tsx', 4)).toContain('register.tsx has been read 4×')
    expect(subagentTip(2_000_000, 500_000)).toBeUndefined()
    expect(subagentTip(1_000_000, 1_500_000)).toContain('60%')
  })

  test('cache countdown: TTL, clock, status, the warning 30 s before', async () => {
    expect(cacheTtlMs(undefined)).toBe(5 * 60_000)
    expect(cacheTtlMs('1h')).toBe(60 * 60_000)
    expect(clock(222_000)).toBe('3:42')
    expect(clock(6_100)).toBe('0:07')
    expect(cacheStatus(222_000)).toBe('⏳ cache 3:42')
    expect(cacheStatus(42_000)).toBe('⌛ cache 0:42!')
    expect(cacheStatus(-1)).toBe('❄️ cache expired')
    expect(cacheSoonWarning(45_000, 300_000, opus)).toBeUndefined() // not yet
    expect(cacheSoonWarning(25_000, 20_000, opus)).toBeUndefined() // small context
    expect(cacheSoonWarning(25_000, 300_000, opus)).toContain('expires in 25 s')
    expect(cacheSoonWarning(25_000, 300_000, opus)).toContain('would cost ≈ $1.50')
    expect(cacheExpiryWarning(10 * 60_000, 300_000, opus, 60 * 60_000)).toBeUndefined() // 1h cache still warm
  })

  test('keep, /compact or /clear: priced for the next 10 turns', async () => {
    const cents = (x: number) => Math.round(x * 100)
    const cold = restartCosts(300_000, 30_000, opus, false)
    expect([cents(cold.keep), cents(cold.compact), cents(cold.clear)]).toEqual([204, 192, 20])
    expect(cold.best).toBe('keep')
    expect(restartCosts(600_000, 30_000, opus, false).best).toBe('compact')
    expect(restartCosts(300_000, 30_000, opus, true).best).toBe('compact')
    expect(clearOrRewriteTip(30_000, 20_000, opus)).toBeUndefined()
    expect(clearOrRewriteTip(300_000, 30_000, opus)).toContain('keep going ~$2.04 · /compact ~$1.92 · /clear ~$0.20')
    expect(clearOrRewriteTip(300_000, 30_000, opus)).toContain('just keep going')
    expect(cacheSoonWarning(25_000, 300_000, opus)).toContain('/compact now (~$0.22 while it\'s warm)')
  })

  test('forecast and its tip', async () => {
    expect(forecast(100, '2026-10-11')).toBe((100 / 10.5) * 31)
    expect(forecastTip(10, '2026-10-02', 800)).toBeUndefined() // too early to tell
    expect(forecastTip(600, '2026-10-15', 800)).toContain('budget $800')
    expect(forecastTip(600, '2026-10-15', 800)).toContain('/day')
    expect(forecastTip(100, '2026-10-15', 800)).toContain('📊')
    expect(forecastTip(900, '2026-10-15', 800)).toContain('already spent')
  })

  test('output share, failures and the dear weekday rest on LiteLLM numbers', async () => {
    const heavy: Day = {
      date: '2026-10-14',
      metrics: metrics(10),
      models: { 'azure_ai/claude-opus-5-5': metrics(10, { completionTokens: 250_000 }) },
    }
    const prices = (m: string) => priceFor({ 'claude-opus-5-5': opus }, m)
    expect(outputTip(heavy, prices)).toContain('50%')
    expect(failedTip({ ...heavy, metrics: metrics(10, { failed: 1, requests: 100 }) })).toBeUndefined()
    expect(failedTip({ ...heavy, metrics: metrics(10, { failed: 6, requests: 100 }) })).toContain('6 requests')

    const days: Day[] = []
    for (let i = 0; i < 28; i++) {
      const date = new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10) // starts on a Monday
      const tuesday = new Date(`${date}T00:00:00Z`).getUTCDay() === 2
      days.push({ date, metrics: metrics(tuesday ? 90 : 20), models: {} })
    }
    expect(weekdayTip(days)).toContain('Tuesdays')
    expect(weekdayTip(days.slice(0, 9))).toBeUndefined() // not enough history
  })

  test('compact effect needs three turns on each side', async () => {
    expect(compactEffectTip([100, 100, 100], [60, 60])).toBeUndefined()
    expect(compactEffectTip([100, 100, 100], [60, 60, 60])).toContain('40%')
    expect(compactEffectTip([100, 100, 100], [95, 95, 95])).toBeUndefined()
  })

  test('quests: one a day, deterministic, and they pay only within budget', async () => {
    expect(questFor('2026-10-15').id).toBe(questFor('2026-10-15').id)
    expect(new Set(Array.from({ length: 30 }, (_, i) => questFor(`2026-10-${String(i + 1).padStart(2, '0')}`).id)).size).toBeGreaterThan(2)

    const cheap = QUESTS.find(q => q.id === 'half')!
    const date = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'].find(d => questFor(d).id === 'half')
    if (date) {
      const ledger = newLedger('2026-10-15', 0)
      const day = { date, metrics: metrics(5), models: {} } as Day
      expect(cheap.done(day, 25)).toBe(true)
      const result = credit(ledger, [day], '2026-10-15', 25)
      expect(result.quests).toEqual([date])
      expect(result.ledger.quests[date]).toBe(5)
    }
  })

  test('tips speak in the pack voice', async () => {
    expect(voice('📈 At this pace it gets dear.', packById('miser'), 2)).toBe('📈 At this pace it gets dear.')
    expect(voice('📈 At this pace it gets dear.', packById('grandma'), 0)).toBe('📈 Sweetie, at this pace it gets dear.')
    expect(voice('📦 The Bash output is big.', packById('auditor'), 0)).toBe('📦 Official recommendation: the Bash output is big.')
    expect(voice('🧠 Opus is too much.', packById('auditor'), 0)).toBe('🧠 Official recommendation: Opus is too much.')
    expect(voice('📅 Tuesdays are dear.', packById('auditor'), 0)).toBe('📅 Official recommendation: Tuesdays are dear.')
  })
})
