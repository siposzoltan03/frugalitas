import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { addPlugin, parseJsonc, removePlugin, run, stripJsonc } from '../install.mjs'

describe('JSONC helpers', () => {
  test('stripJsonc keeps the length and blanks comments, not strings', () => {
    const text = '{ "a": "// not a comment", /* x */ "b": 1 // tail\n}'
    const out = stripJsonc(text)
    assert.equal(out.length, text.length)
    assert.ok(out.includes('"// not a comment"'))
    assert.ok(!out.includes('tail'))
    assert.ok(!out.includes('x */'))
  })
  test('parseJsonc takes comments and trailing commas', () => {
    assert.deepEqual(parseJsonc('{ // c\n "a": [1, 2,], }'), { a: [1, 2] })
    assert.equal(parseJsonc('{ nope'), undefined)
  })
})

describe('addPlugin / removePlugin', () => {
  test('creates the plugin key and keeps comments', () => {
    const out = addPlugin('{\n  // keep me\n  "model": "x"\n}\n', '/a/tui.tsx')!
    assert.match(out, /\/\/ keep me/)
    assert.deepEqual(parseJsonc(out), { plugin: ['/a/tui.tsx'], model: 'x' })
  })
  test('an empty object gets no trailing comma', () => {
    assert.deepEqual(parseJsonc(addPlugin('{}', '/a')!), { plugin: ['/a'] })
  })
  test('adds to an existing array, inline and multi-line', () => {
    assert.deepEqual(parseJsonc(addPlugin('{ "plugin": ["p"] }', '/a')!)?.plugin, ['/a', 'p'])
    assert.deepEqual(parseJsonc(addPlugin('{ "plugin": [] }', '/a')!)?.plugin, ['/a'])
    assert.deepEqual(parseJsonc(addPlugin('{\n  "plugin": [\n    "p"\n  ]\n}', '/a')!)?.plugin, ['/a', 'p'])
  })
  test('a "plugin" mentioned in a comment or string is not the key', () => {
    const out = addPlugin('{\n  // "plugin": ["fake"]\n  "note": "\\"plugin\\": [x]"\n}', '/a')!
    assert.deepEqual(parseJsonc(out)?.plugin, ['/a'])
  })
  test('is idempotent', () => {
    const once = addPlugin('{}', '/a')!
    assert.equal(addPlugin(once, '/a'), once)
  })
  test('remove takes it out, first, middle or last, and only it', () => {
    for (const plugin of [['/a', 'p'], ['p', '/a'], ['p', '/a', 'q'], ['/a']]) {
      const text = JSON.stringify({ plugin, other: 1 })
      assert.deepEqual(parseJsonc(removePlugin(text, '/a')!)?.plugin, plugin.filter(x => x !== '/a'))
    }
    assert.equal(removePlugin('{ "plugin": ["p"] }', '/a'), '{ "plugin": ["p"] }')
  })
})

describe('run', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'frugalitas-install-'))

  test('installs into a fresh config dir, then does nothing the second time', () => {
    const configDir = dir()
    run({ configDir })
    const tui = parseJsonc(readFileSync(join(configDir, 'tui.json'), 'utf8'))
    const main = parseJsonc(readFileSync(join(configDir, 'opencode.jsonc'), 'utf8'))
    assert.match(tui.plugin[0], /opencode\/tui\.tsx$/)
    assert.match(main.plugin[0], /opencode\/server\.ts$/)
    assert.equal(parseJsonc(readFileSync(join(configDir, 'frugalitas.json'), 'utf8')).overBudget, 'warn')
    const again = run({ configDir })
    assert.ok(again.some(l => l.includes('already in')))
    assert.equal(parseJsonc(readFileSync(join(configDir, 'tui.json'), 'utf8')).plugin.length, 1)
  })

  test('keeps an existing options file and comments in the config, and warns without a litellm provider', () => {
    const configDir = dir()
    writeFileSync(join(configDir, 'opencode.jsonc'), '{\n  // mine\n  "model": "m"\n}\n')
    writeFileSync(join(configDir, 'frugalitas.json'), '{"dailyBudget": 5}')
    const log = run({ configDir })
    assert.match(readFileSync(join(configDir, 'opencode.jsonc'), 'utf8'), /\/\/ mine/)
    assert.equal(readFileSync(join(configDir, 'frugalitas.json'), 'utf8'), '{"dailyBudget": 5}')
    assert.ok(log.some(l => l.includes('"litellm"')))
  })

  test('a dry run writes nothing', () => {
    const configDir = join(dir(), 'opencode')
    run({ configDir, dryRun: true })
    assert.equal(existsSync(configDir), false)
  })

  test('a config that is not valid JSON is left alone', () => {
    const configDir = dir()
    writeFileSync(join(configDir, 'opencode.jsonc'), '{ broken')
    const log = run({ configDir })
    assert.equal(readFileSync(join(configDir, 'opencode.jsonc'), 'utf8'), '{ broken')
    assert.ok(log.some(l => l.startsWith('✗')))
  })

  test('uninstall removes the entries and keeps options', () => {
    const configDir = dir()
    run({ configDir })
    run({ configDir, uninstall: true })
    assert.deepEqual(parseJsonc(readFileSync(join(configDir, 'tui.json'), 'utf8')).plugin, [])
    assert.deepEqual(parseJsonc(readFileSync(join(configDir, 'opencode.jsonc'), 'utf8')).plugin, [])
    assert.ok(existsSync(join(configDir, 'frugalitas.json')))
  })

  test('warns about an opencode version it was not written for', () => {
    const log = run({ configDir: dir(), opencodeVersion: '1.19.2' })
    assert.ok(log.some(l => l.includes('1.19.2')))
  })
})
