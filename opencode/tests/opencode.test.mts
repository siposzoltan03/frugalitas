import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, test } from 'node:test'

// shared.ts reads files under $HOME at call time (homedir()), so point HOME at a scratch folder first.
const home = mkdtempSync(join(tmpdir(), 'frugalitas-test-'))
process.env.HOME = home
mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
const cfg = (name: string, text: string) => writeFileSync(join(home, '.config', 'opencode', name), text)

const shared = await import('../shared')
const { mascotCells } = await import('../mascot-cells')
const { rowsOf } = await import('../restart')
const { adviceFrom } = await import('../report')
const { shopItems, shopRow, xpText } = await import('../ledger')
const { setMode } = await import('../../hooks/mode')
const { skinById } = await import('../../hooks/skins')
const { packById } = await import('../../hooks/packs')
const { asLedger } = await import('../../hooks/xp')

before(() => setMode('frugalitas'))

describe('options file', () => {
  test('entry options win over the file; a missing file is fine', () => {
    assert.deepEqual(shared.loadOptions({ a: 1 }), { a: 1 })
    cfg('frugalitas.json', JSON.stringify({ dailyBudget: 25, mode: 'fukarlec' }))
    assert.deepEqual(shared.loadOptions({ dailyBudget: 5 }), { dailyBudget: 5, mode: 'fukarlec' })
  })
  test('a broken file is ignored', () => {
    cfg('frugalitas.json', '{not json')
    assert.deepEqual(shared.loadOptions({ x: 1 }), { x: 1 })
  })
  test('numOption falls back on junk, keeps 0', () => {
    assert.equal(shared.numOption({ a: '12' }, 'a', 1), 12)
    assert.equal(shared.numOption({ a: 0 }, 'a', 1), 0)
    assert.equal(shared.numOption({ a: 'x' }, 'a', 1), 1)
    assert.equal(shared.numOption({}, 'a', 7), 7)
  })
  test('saveOption keeps the other options', () => {
    cfg('frugalitas.json', JSON.stringify({ dailyBudget: 25 }))
    shared.saveOption('mode', 'fukarlec')
    assert.deepEqual(shared.loadOptions(), { dailyBudget: 25, mode: 'fukarlec' })
  })
})

describe('connection from the opencode config', () => {
  test('strips /v1, resolves {file:}, keeps provider headers', () => {
    writeFileSync(join(home, 'key.txt'), ' secret\n')
    const conn = shared.connFromConfig({
      provider: { litellm: { options: { baseURL: 'https://proxy.example/v1', apiKey: `{file:${join(home, 'key.txt')}}`, headers: { 'X-Test': 'yes' } } } },
    })
    assert.equal(conn?.baseUrl, 'https://proxy.example')
    assert.equal(conn?.headers.Authorization, 'Bearer secret')
    assert.equal(conn?.headers['X-Test'], 'yes')
  })
  test('no litellm provider means no connection', () => {
    assert.equal(shared.connFromConfig({ provider: {} }), undefined)
    assert.equal(shared.connFromConfig(undefined), undefined)
  })
})

describe('allow and blocked files', () => {
  test('allow lasts for the UTC day', () => {
    const now = Date.UTC(2026, 9, 21, 12)
    assert.equal(shared.isAllowed(now), false)
    shared.allowToday(now)
    assert.equal(shared.isAllowed(now), true)
    assert.equal(shared.isAllowed(now + 24 * 3600_000), false)
  })
  test('a blocked note round-trips', () => {
    shared.noteBlocked('over budget', 123)
    assert.deepEqual(shared.readBlocked(), { at: 123, message: 'over budget' })
  })
})

describe('mascot cells', () => {
  const skin = skinById('miser')
  test('large is 24 columns by 22 rows, small is half of each', () => {
    const large = mascotCells(skin, 'calm', 1)
    assert.equal(large.length, 22)
    assert.ok(large.every(r => r.length === 24))
    const small = mascotCells(skin, 'calm', 2)
    assert.equal(small.length, 11)
    assert.ok(small.every(r => r.length === 12))
  })
  test('cells are blank, or a half block with a color', () => {
    for (const row of mascotCells(skin, 'angry', 1)) {
      for (const c of row) {
        if (c.ch === ' ') assert.equal(c.fg, undefined)
        else assert.match(c.fg ?? '', /^#[0-9a-f]{6}$/)
      }
    }
  })
  test('moods differ', () => {
    const a = JSON.stringify(mascotCells(skin, 'calm', 1))
    assert.notEqual(a, JSON.stringify(mascotCells(skin, 'angry', 1)))
  })
})

describe('transcript rows from opencode messages', () => {
  test('keeps text and tool calls, drops synthetic text and other roles', () => {
    const rows = rowsOf([
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'fix the bug' }, { type: 'text', text: 'noise', synthetic: true }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'looking' }, { type: 'tool', tool: 'read', state: { status: 'completed', input: { path: 'a.ts' }, output: 'contents' } }] },
      { info: { role: 'system' }, parts: [{ type: 'text', text: 'ignored' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'bash', state: { status: 'error', input: { cmd: 'x' }, error: 'boom' } }] },
    ])
    assert.equal(rows.length, 3)
    assert.equal(rows[0]!.text, 'fix the bug')
    assert.equal(rows[1]!.toolUses[0]!.text, 'contents')
    assert.equal(rows[2]!.toolUses[0]!.isError, true)
    assert.equal(rows[2]!.toolUses[0]!.text, 'boom')
  })
})

describe('advice', () => {
  const metrics = (spend: number) => ({ spend, promptTokens: 0, completionTokens: 0, cacheRead: 0, cacheWrite: 0, cacheSaved: 0, requests: 1, failed: 0 })
  const day = (date: string, spend: number) => ({ date, metrics: metrics(spend), models: {} })
  const pack = packById(undefined)

  test('forecast tip and a quest line when a daily budget is set', () => {
    const month = { days: [day('2026-10-20', 100), day('2026-10-21', 100)], total: metrics(200) }
    const a = adviceFrom({ month, history: undefined, date: '2026-10-21', budgets: { session: 10, daily: 25, monthly: 100 }, priceOf: () => undefined, fun: false, pack })
    assert.ok(a.tips.some(t => /budget|month/i.test(t)))
    assert.match(a.quest ?? '', /quest/i)
  })
  test('no quest without a daily budget', () => {
    const month = { days: [], total: metrics(0) }
    const a = adviceFrom({ month, history: undefined, date: '2026-10-21', budgets: { session: 0, daily: 0, monthly: 0 }, priceOf: () => undefined, fun: false, pack })
    assert.equal(a.quest, null)
  })
})

describe('shop and coins', () => {
  const ledger = asLedger(undefined, '2026-10-21', 0)
  test('the shop sells skins and packs, free defaults owned', () => {
    const items = shopItems()
    assert.ok(items.some(i => i.kind === 'skin'))
    assert.ok(items.some(i => i.kind === 'pack'))
    const free = items.find(i => i.price === 0 && i.kind === 'skin')!
    assert.match(shopRow(ledger, free).title, /^(👉|✅)/)
    const paid = items.find(i => i.price > 0)!
    assert.match(shopRow(ledger, paid).title, /^🔒/)
  })
  test('rank text names the rank and the balance', () => {
    assert.match(xpText(ledger, 25), /coins earned/)
  })
})
