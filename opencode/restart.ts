// `/frugal restart` for opencode: a small model writes a handover from the conversation, and a fresh session
// starts from it. Handovers are kept as files under ~/.config/opencode/frugalitas-handovers/.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  condenseTranscript,
  HANDOVER_SYSTEM,
  handoverMarkdown,
  handoverPrompt,
  pickSummaryModel,
  tokensOfText,
} from '../hooks/advice'
import type { Handover, TranscriptRow } from '../hooks/advice'
import type { Conn, Prices } from '../hooks/litellm'

/** A condensed transcript stays under ~140k tokens: room in Haiku's 200k window. */
export const MAX_HANDOVER_CHARS = 560_000

const DIR = join(homedir(), '.config', 'opencode', 'frugalitas-handovers')

/** opencode's messages (`{info, parts}`) as the transcript rows the summary needs. */
export function rowsOf(messages: readonly { info: { role: string }; parts: readonly any[] }[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const { info, parts } of messages) {
    if (info.role !== 'user' && info.role !== 'assistant') continue
    const text = parts
      .filter(p => p.type === 'text' && !p.synthetic && !p.ignored)
      .map(p => String(p.text))
      .join('\n')
    const toolUses = parts
      .filter(p => p.type === 'tool')
      .map(p => ({
        tool: String(p.tool),
        input: (p.state?.input ?? {}) as Record<string, unknown>,
        ...(typeof p.state?.output === 'string' ? { text: p.state.output as string } : typeof p.state?.error === 'string' ? { text: p.state.error as string } : {}),
        ...(p.state?.status === 'error' ? { isError: true as const } : {}),
      }))
    if (text.trim() || toolUses.length > 0) rows.push({ role: info.role, text, toolUses })
  }
  return rows
}

/** One chat completion through the proxy (OpenAI-compatible endpoint). */
async function complete(conn: Conn, model: string, system: string, prompt: string): Promise<{ text: string; input: number; output: number }> {
  const res = await fetch(`${conn.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...conn.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4_000, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  })
  const body: any = await res.json().catch(() => ({}))
  const text = body?.choices?.[0]?.message?.content
  if (!res.ok || typeof text !== 'string' || !text.trim()) throw new Error(`HTTP ${res.status}${body?.error?.message ? ` – ${String(body.error.message).slice(0, 120)}` : ''}`)
  return { text, input: Number(body?.usage?.prompt_tokens ?? 0), output: Number(body?.usage?.completion_tokens ?? 0) }
}

export type Written = { handover: Handover; cost: number }

/** Writes a handover for `rows` with the cheapest Haiku (or Sonnet) that fits, and saves it. */
export async function writeHandover(opts: {
  conn: Conn
  prices: Record<string, Prices>
  rows: TranscriptRow[]
  cwd: string
  sonnetOnly: boolean
}): Promise<Written | { error: string }> {
  const transcript = condenseTranscript(opts.rows, MAX_HANDOVER_CHARS)
  const small = pickSummaryModel(opts.prices, tokensOfText(transcript.length), opts.sonnetOnly)
  if (!small) return { error: 'the proxy serves no Haiku or Sonnet with room for this conversation' }
  const reply = await complete(opts.conn, small.name, HANDOVER_SYSTEM, handoverPrompt(transcript))
  const now = Date.now()
  const id = now.toString(36)
  const handover: Handover = { id, at: now, model: small.name, cwd: opts.cwd, text: reply.text, path: join(DIR, `${id}.md`) }
  mkdirSync(DIR, { recursive: true })
  writeFileSync(handover.path!, handoverMarkdown(handover))
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify(handover))
  return { handover, cost: reply.input * small.price.input + reply.output * small.price.output }
}

/** Saved handovers, newest first. */
export function listHandovers(): Handover[] {
  try {
    return readdirSync(DIR)
      .filter(f => f.endsWith('.json'))
      .flatMap(f => {
        try {
          const h = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Handover
          return h?.text ? [h] : []
        } catch {
          return []
        }
      })
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}
