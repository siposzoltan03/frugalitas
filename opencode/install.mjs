#!/usr/bin/env node
// Installs the Frugalitas plugins into opencode (and so into apex, which runs on opencode).
//
//   node opencode/install.mjs               install
//   node opencode/install.mjs --dry-run     show what would change, change nothing
//   node opencode/install.mjs --uninstall   take the plugin entries out again
//
// It edits the GLOBAL opencode config (~/.config/opencode), never a workspace's: apex regenerates its
// workspace opencode.json on every update, which would wipe the entries. Existing comments and formatting
// in the config files are kept (the entries are inserted as text, not by rewriting the JSON).
// Needs Node 18+.
// @ts-check
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TESTED_ON = '1.18'

/**
 * The text with comments blanked out (strings respected). Same length as the input, comment characters become
 * spaces, so an index into the result is an index into the original.
 */
/** @param {string} text */
export function stripJsonc(text) {
  const out = text.split('')
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' '
      i--
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      for (; i < stop; i++) if (text[i] !== '\n') out[i] = ' '
      i--
    }
  }
  return out.join('')
}

/** Parses JSONC (comments and trailing commas allowed); undefined when it is not valid. */
/** @param {string} text @returns {any} */
export function parseJsonc(text) {
  try {
    return JSON.parse(stripJsonc(text).replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return undefined
  }
}

/** Where `"plugin": [` opens in the text, outside comments and strings. */
/** @param {string} text */
function pluginArrayAt(text) {
  const blank = stripJsonc(text)
  const m = /"plugin"\s*:\s*\[/.exec(blank)
  return m ? m.index + m[0].length : -1
}

/**
 * `text` with `spec` added to the top-level "plugin" array (created when missing). Returns the same text when
 * it is already there, and undefined when the result would not be valid JSONC (nothing should be written then).
 */
/** @param {string} text @param {string} spec @returns {string | undefined} */
export function addPlugin(text, spec) {
  if (text.includes(JSON.stringify(spec))) return text
  const entry = JSON.stringify(spec)
  let next
  const at = pluginArrayAt(text)
  if (at >= 0) {
    const after = text.slice(at)
    const empty = /^\s*\]/.test(stripJsonc(after))
    const multiline = /^[ \t]*\r?\n/.test(after)
    if (multiline) {
      const indent = /\n([ \t]*)\S/.exec(after)?.[1] ?? '    '
      next = `${text.slice(0, at)}\n${indent}${entry}${empty ? '' : ','}${after}`
    } else next = `${text.slice(0, at)}${entry}${empty ? '' : ', '}${after}`
  } else {
    const open = stripJsonc(text).indexOf('{')
    if (open < 0) return undefined
    const empty = /^\s*\}/.test(stripJsonc(text).slice(open + 1))
    next = `${text.slice(0, open + 1)}\n  "plugin": [${entry}]${empty ? '' : ','}${text.slice(open + 1)}`
  }
  return parseJsonc(next) ? next : undefined
}

/** `text` without the plugin entry for `spec` (and its comma); the same text when it is not there. */
/** @param {string} text @param {string} spec @returns {string | undefined} */
export function removePlugin(text, spec) {
  const entry = JSON.stringify(spec).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Last in its array: take the comma before it. Otherwise take the comma after it, and its line.
  const last = new RegExp(`,\\s*${entry}(?=\\s*\\])`)
  const next = last.test(text) ? text.replace(last, '') : text.replace(new RegExp(`[ \\t]*${entry}[ \\t]*,?[ \\t]*\\r?\\n?`), '')
  return parseJsonc(next) ? next : undefined
}

const DEFAULT_OPTIONS = {
  overBudget: 'warn',
  sessionBudget: 20,
  dailyBudget: 60,
  monthlyBudget: 800,
}

/** What this script would do, and does unless `dryRun`. Returns the lines to print. */
/** @param {{ configDir: string, uninstall?: boolean, dryRun?: boolean, opencodeVersion?: string }} opts @returns {string[]} */
export function run({ configDir, uninstall = false, dryRun = false, opencodeVersion }) {
  /** @type {string[]} */
  const log = []
  const tuiSpec = join(HERE, 'tui.tsx')
  const serverSpec = join(HERE, 'server.ts')
  for (const f of [tuiSpec, serverSpec]) if (!existsSync(f)) throw new Error(`missing ${f}: run this from a full clone of the repo`)

  /** @param {string[]} names */
  const pick = names => names.map(n => join(configDir, n)).find(existsSync)
  const targets = [
    { label: 'TUI plugin', file: pick(['tui.json', 'tui.jsonc']) ?? join(configDir, 'tui.json'), spec: tuiSpec, fresh: '{\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": []\n}\n' },
    { label: 'budget guard', file: pick(['opencode.jsonc', 'opencode.json']) ?? join(configDir, 'opencode.jsonc'), spec: serverSpec, fresh: '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": []\n}\n' },
  ]

  if (!dryRun) mkdirSync(configDir, { recursive: true })
  for (const t of targets) {
    const exists = existsSync(t.file)
    const before = exists ? readFileSync(t.file, 'utf8') : t.fresh
    if (exists && !parseJsonc(before)) {
      log.push(`✗ ${t.file} is not valid JSON(C); left alone. Add this to its "plugin" array yourself: ${JSON.stringify(t.spec)}`)
      continue
    }
    const after = uninstall ? removePlugin(before, t.spec) : addPlugin(before, t.spec)
    if (after === undefined) {
      log.push(`✗ could not edit ${t.file} safely. Add this to its "plugin" array yourself: ${JSON.stringify(t.spec)}`)
      continue
    }
    if (uninstall && !exists) continue
    if (after === before && exists) {
      log.push(`· ${t.label}: ${uninstall ? 'was not' : 'already'} in ${t.file}`)
      continue
    }
    if (!dryRun) writeFileSync(t.file, after)
    log.push(`${dryRun ? '○ would ' : '✓ '}${uninstall ? 'remove' : 'add'} the ${t.label} ${uninstall ? 'from' : 'to'} ${t.file}`)
  }

  if (!uninstall) {
    const options = join(configDir, 'frugalitas.json')
    if (existsSync(options)) log.push(`· options file kept: ${options}`)
    else {
      if (!dryRun) writeFileSync(options, `${JSON.stringify(DEFAULT_OPTIONS, null, 2)}\n`)
      log.push(`${dryRun ? '○ would write' : '✓ wrote'} default options (budgets, warn mode) to ${options}`)
    }
    const main = pick(['opencode.jsonc', 'opencode.json'])
    const config = main ? parseJsonc(readFileSync(main, 'utf8')) : undefined
    if (!config?.provider?.litellm) {
      log.push('! No provider named "litellm" in your opencode config: Frugalitas reads the proxy URL, key and headers from it and stays silent without it.')
    }
    if (opencodeVersion && !opencodeVersion.startsWith(TESTED_ON)) {
      log.push(`! opencode ${opencodeVersion}: the TUI plugin API changes between versions and this was written for ${TESTED_ON}.x. If the sidebar stays empty, check ${join(configDir, 'frugalitas-debug.log')}.`)
    }
  }
  log.push('', uninstall ? 'Restart opencode. Your options, coins and handovers in the config folder were left in place.' : 'Restart opencode (or apex). The status line shows next to the prompt, the rest under /frugal. Options: ' + join(configDir, 'frugalitas.json'))
  return log
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('node opencode/install.mjs [--dry-run] [--uninstall] [--config-dir <dir>]')
    return
  }
  const at = args.indexOf('--config-dir')
  const configDir = resolve(at >= 0 && args[at + 1] ? String(args[at + 1]) : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode'))
  let opencodeVersion
  try {
    opencodeVersion = execFileSync('opencode', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {}
  try {
    for (const line of run({ configDir, uninstall: args.includes('--uninstall'), dryRun: args.includes('--dry-run'), opencodeVersion })) console.log(line)
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
