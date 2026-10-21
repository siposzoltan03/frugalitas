// Pieces both opencode entry points (tui.tsx, server.ts) need.
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { utcDate } from '../hooks/format'
import { makeConn } from '../hooks/litellm'
import type { Conn, Fetch } from '../hooks/litellm'

export const PROVIDER = 'litellm'

// litellm.ts wants a {ok, status, text} response.
export const fetchLite: Fetch = async (url, init) => {
  const res = await fetch(url, init)
  return { ok: res.ok, status: res.status, text: await res.text() }
}

/** opencode's `{file:...}` / `{env:...}` substitutions may arrive unresolved in state.config. */
function resolve(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const f = v.match(/^\{file:(.+)\}$/)
  if (f) return readFileSync(f[1]!.replace(/^~/, process.env.HOME ?? '~'), 'utf8').trim()
  const e = v.match(/^\{env:(.+)\}$/)
  if (e) return process.env[e[1]!]
  return v
}

export function connFromConfig(cfg: any): Conn | undefined {
  const o = cfg?.provider?.[PROVIDER]?.options
  if (!o) return undefined
  const base = String(o.baseURL ?? '').replace(/\/v1\/?$/, '')
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries<any>(o.headers ?? {})) {
    const r = resolve(v)
    if (r) headers[k] = r
  }
  const conn = makeConn({ baseUrl: base, authToken: resolve(o.apiKey) })
  return conn && { ...conn, headers: { ...headers, ...conn.headers } }
}

/** `/frugal allow`: the TUI writes today's date here, the server plugin lifts the block while it matches. */
const ALLOW_FILE = join(homedir(), '.config', 'opencode', 'frugalitas-allow.json')

export function allowToday(now = Date.now()): void {
  writeFileSync(ALLOW_FILE, JSON.stringify({ date: utcDate(now) }))
}

export function isAllowed(now = Date.now()): boolean {
  try {
    return JSON.parse(readFileSync(ALLOW_FILE, 'utf8')).date === utcDate(now)
  } catch {
    return false
  }
}

/** The server plugin's refusal, handed to the TUI plugin to show: opencode only says "Failed to send prompt". */
const BLOCKED_FILE = join(homedir(), '.config', 'opencode', 'frugalitas-blocked.json')

export function noteBlocked(message: string, now = Date.now()): void {
  writeFileSync(BLOCKED_FILE, JSON.stringify({ at: now, message }))
}

export function readBlocked(): { at: number; message: string } | undefined {
  try {
    const b = JSON.parse(readFileSync(BLOCKED_FILE, 'utf8'))
    return typeof b?.at === 'number' && typeof b?.message === 'string' ? b : undefined
  } catch {
    return undefined
  }
}
