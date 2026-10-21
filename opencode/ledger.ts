// Coins, ranks and the shop for the opencode plugin. The ledger is a file of its own (not Claude Code's store):
// both tools credit the same LiteLLM days, so merge them only deliberately (see mergeFukarlec in ../hooks/xp.ts).
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { QUEST_XP } from '../hooks/advice'
import { addDays, money } from '../hooks/format'
import { fetchActivity } from '../hooks/litellm'
import type { Conn } from '../hooks/litellm'
import { tr } from '../hooks/mode'
import { modePacks } from '../hooks/packs'
import { asLedger, balance, credit, creditFrom, earned, owns, progressBar, rankOf, worn } from '../hooks/xp'
import type { Ledger, ShopItem } from '../hooks/xp'
import { fetchLite } from './shared'

const LEDGER_FILE = join(homedir(), '.config', 'opencode', 'frugalitas-ledger.json')

export function loadLedger(today: string, now = Date.now()): Ledger {
  try {
    return asLedger(JSON.parse(readFileSync(LEDGER_FILE, 'utf8')), today, now)
  } catch {
    return asLedger(undefined, today, now)
  }
}

export function saveLedger(l: Ledger): void {
  writeFileSync(LEDGER_FILE, JSON.stringify(l))
}

/** Pays out the closed days since the last credit. `gained` is 0 when there was nothing new. */
export async function creditDays(conn: Conn, l: Ledger, today: string, dailyBudget: number): Promise<{ ledger: Ledger; gained: number; quests: number }> {
  const from = creditFrom(l)
  const to = addDays(today, -1)
  if (dailyBudget <= 0 || from > to) return { ledger: l, gained: 0, quests: 0 }
  const activity = await fetchActivity(fetchLite, conn, from, to)
  const r = credit(l, activity.days, today, dailyBudget)
  return { ledger: r.ledger, gained: r.gained, quests: r.quests.length }
}

/**
 * What the opencode shop sells: message packs only. Skins are the dashboard mascot's outfits, and the
 * opencode port has no mascot yet.
 */
export const shopItems = (): ShopItem[] => modePacks().map(p => ({ kind: 'pack' as const, id: p.id, name: p.name, description: p.description, price: p.price }))

export function xpText(l: Ledger, dailyBudget: number): string {
  const total = earned(l)
  const r = rankOf(total)
  const recent = Object.entries(l.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7)
  return [
    tr(`${r.emoji} ${r.name} · ${total} coins earned · ${balance(l)} in your pocket`, `${r.emoji} ${r.name} · ${total} garas szerezve · ${balance(l)} a zsebben`),
    r.next ? `${progressBar(r.progress)} → ${r.next.name} (${r.next.at})` : tr(`${progressBar(1)} top rank!`, `${progressBar(1)} a legmagasabb rang!`),
    '',
    recent.length > 0
      ? `${tr('Recent days', 'Utolsó napok')}: ${recent.map(([d, xp]) => `${d.slice(5)} ${xp > 0 ? `+${xp + (l.quests[d] ?? 0)}${l.quests[d] ? '🎯' : ''}` : '0 🔥'}`).join(' · ')}`
      : tr('No credited days yet: coins are paid for closed (UTC) days.', 'Még nincs jóváírt nap: a lezárt (UTC) napokért jár garas.'),
    '',
    tr(`Rule: an active day within the daily budget (${money(dailyBudget)}) = 10 + up to 10 for thrift + streak bonus (up to +10);`, `Szabály: napi keret (${money(dailyBudget)}) alatti aktív nap = 10 + max 10 a spórolásért + sorozat-bónusz (max +10),`),
    tr(`a completed daily quest +${QUEST_XP}.`, `a teljesített napi küldetés +${QUEST_XP}.`),
  ].join('\n')
}

/** One shop row's title, price and state for the picker. */
export function shopRow(l: Ledger, i: ShopItem): { title: string; footer: string; description: string } {
  const wearing = worn(l).pack === i.id
  const mark = wearing ? '👉' : owns(l, i) ? '✅' : '🔒'
  const price = i.price === 0 ? tr('free', 'ingyen') : tr(`${i.price} coins`, `${i.price} garas`)
  return { title: `${mark} ${i.name}`, footer: price, description: i.description }
}
