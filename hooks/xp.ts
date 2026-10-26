import { QUEST_XP, questFor } from './advice'
import { addDays } from './format'
import type { Day } from './litellm'
import { cmd, mode, tr } from './mode'

// XP ("coins") for thrift: every closed UTC day with spend that stayed within the
// daily budget earns coins, read off LiteLLM's own daily numbers. A credited day is
// frozen in the ledger, so raising the budget later does not pay out the past again.
// Garas are spent in the shop on skins and message packs.

export type Ledger = {
  /** The first day that may earn coins. */
  since: string
  /** Each credited day's coins; 0 for an active day over budget (it breaks the streak). */
  days: Record<string, number>
  /** Bonus coins for the day's quest, by day. */
  quests: Record<string, number>
  /** Garas spent in the shop. */
  spent: number
  /** What was bought: `skin:<id>` and `pack:<id>`. */
  owned: string[]
  /** What Frugalitas mode wears. */
  skin: string
  pack: string
  /** What Fukarléc mode wears, so switching modes back and forth keeps each mode's choice. */
  fukarlec: { skin: string; pack: string }
  /** Not `at`: the store's pruning drops values whose `at` is old. */
  updatedAt: number
}

export const XP_BASE = 10
export const XP_THRIFT_MAX = 10
export const XP_STREAK_STEP = 2
export const XP_STREAK_CAP = 5

/** Days before the first run that still count, as a welcome. */
const WELCOME_DAYS = 7

export function newLedger(today: string, now: number): Ledger {
  return { since: addDays(today, -WELCOME_DAYS), days: {}, quests: {}, spent: 0, owned: [], skin: 'miser', pack: 'miser', fukarlec: { skin: 'paraszt', pack: 'paraszt' }, updatedAt: now }
}

/** Reads back whatever the store held, filling what an older version did not write. */
export function asLedger(value: unknown, today: string, now: number): Ledger {
  const fresh = newLedger(today, now)
  if (!value || typeof value !== 'object') return fresh
  const v = value as Partial<Ledger>
  return {
    since: typeof v.since === 'string' ? v.since : fresh.since,
    days: v.days && typeof v.days === 'object' ? { ...v.days } : {},
    quests: v.quests && typeof v.quests === 'object' ? { ...v.quests } : {},
    spent: typeof v.spent === 'number' ? v.spent : 0,
    owned: Array.isArray(v.owned) ? [...v.owned] : [],
    skin: typeof v.skin === 'string' ? v.skin : fresh.skin,
    pack: typeof v.pack === 'string' ? v.pack : fresh.pack,
    fukarlec: {
      skin: typeof v.fukarlec?.skin === 'string' ? v.fukarlec.skin : fresh.fukarlec.skin,
      pack: typeof v.fukarlec?.pack === 'string' ? v.fukarlec.pack : fresh.fukarlec.pack,
    },
    updatedAt: now,
  }
}

/** Garas for one day: a base, up to 10 more for what stayed unspent, and a streak bonus. */
export function dayXp(spend: number, budget: number, streakBefore: number): number {
  if (budget <= 0 || spend <= 0 || spend > budget) return 0
  const thrift = Math.round(XP_THRIFT_MAX * (1 - spend / budget))
  return XP_BASE + thrift + Math.min(streakBefore, XP_STREAK_CAP) * XP_STREAK_STEP
}

/** Consecutive credited days with coins before `date`; idle days are skipped, a day over budget ends it. */
export function streakBefore(ledger: Ledger, date: string): number {
  let n = 0
  for (const d of Object.keys(ledger.days).filter(d => d < date).sort().reverse()) {
    if (ledger.days[d]! <= 0) break
    n++
  }
  return n
}

/** The first day not yet credited: where to start fetching activity from. */
export function creditFrom(ledger: Ledger): string {
  const credited = Object.keys(ledger.days).sort()
  const last = credited[credited.length - 1]
  return last && last >= ledger.since ? addDays(last, 1) : ledger.since
}

/** Credits every closed day of `days` (before `today`) not yet in the ledger. */
export function credit(
  ledger: Ledger,
  days: readonly Day[],
  today: string,
  budget: number,
): { ledger: Ledger; gained: number; credited: string[]; quests: string[] } {
  const next: Ledger = { ...ledger, days: { ...ledger.days }, quests: { ...ledger.quests } }
  const credited: string[] = []
  const quests: string[] = []
  let gained = 0
  if (budget <= 0) return { ledger: next, gained, credited, quests }
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (day.date >= today || day.date < next.since || next.days[day.date] !== undefined) continue
    if (day.metrics.spend <= 0) continue
    const xp = dayXp(day.metrics.spend, budget, streakBefore(next, day.date))
    next.days[day.date] = xp
    credited.push(day.date)
    gained += xp
    // The quest pays only on a day that stayed within budget.
    if (xp > 0 && questFor(day.date).done(day, budget)) {
      next.quests[day.date] = QUEST_XP
      quests.push(day.date)
      gained += QUEST_XP
    }
  }
  return { ledger: next, gained, credited, quests }
}

export function earned(ledger: Ledger): number {
  const sum = (r: Record<string, number>) => Object.values(r).reduce((n, xp) => n + xp, 0)
  return sum(ledger.days) + sum(ledger.quests)
}

export function balance(ledger: Ledger): number {
  return earned(ledger) - ledger.spent
}

export const RANKS: readonly { name: string; at: number; emoji: string }[] = [
  {
    get name() {
      return tr('Apprentice Saver', 'Napszámos')
    },
    at: 0,
    get emoji() {
      return tr('🪙', '🧺')
    },
  },
  {
    get name() {
      return tr('Penny Pincher', 'Zsellér')
    },
    at: 50,
    get emoji() {
      return tr('🐷', '🌱')
    },
  },
  {
    get name() {
      return tr('Bean Counter', 'Béres')
    },
    at: 150,
    get emoji() {
      return tr('🧮', '🐂')
    },
  },
  {
    get name() {
      return tr('Treasurer', 'Gazda')
    },
    at: 350,
    get emoji() {
      return tr('💼', '🌾')
    },
  },
  {
    get name() {
      return tr('Tycoon', 'Nagygazda')
    },
    at: 700,
    get emoji() {
      return tr('🎩', '🏡')
    },
  },
  {
    get name() {
      return tr('Grand Miser', 'Fukar földesúr')
    },
    at: 1200,
    get emoji() {
      return '🏰'
    },
  },
]

export function rankOf(totalEarned: number): {
  name: string
  emoji: string
  next: { name: string; at: number } | undefined
  progress: number
} {
  let i = 0
  while (i + 1 < RANKS.length && totalEarned >= RANKS[i + 1]!.at) i++
  const current = RANKS[i]!
  const upcoming = RANKS[i + 1]
  const progress = upcoming ? (totalEarned - current.at) / (upcoming.at - current.at) : 1
  return { name: current.name, emoji: current.emoji, next: upcoming && { name: upcoming.name, at: upcoming.at }, progress }
}

export type ShopItem = { kind: 'skin' | 'pack'; id: string; name: string; description: string; price: number }

export function owns(ledger: Ledger, item: ShopItem): boolean {
  return item.price === 0 || ledger.owned.includes(`${item.kind}:${item.id}`)
}

const wearCommand = (item: ShopItem) => `${cmd()} ${item.kind} ${item.id}`

/** Spends coins on `item` and puts it on; never charges for what you already own. */
export function buy(ledger: Ledger, item: ShopItem): { ledger: Ledger } | { error: string } {
  if (owns(ledger, item)) return { error: tr(`You already own ${item.name}. To wear it: ${wearCommand(item)}`, `${item.name} már a tiéd. Felvenni: ${wearCommand(item)}`) }
  const have = balance(ledger)
  if (have < item.price) return { error: tr(`That's ${item.price} coins and you have ${have}. ${item.price - have} more to go.`, `Ez ${item.price} garas, neked ${have} van. Még ${item.price - have} kell.`) }
  const next: Ledger = { ...ledger, owned: [...ledger.owned, `${item.kind}:${item.id}`], spent: ledger.spent + item.price }
  return wear(next, item)
}

/** Puts on an owned `item`; spends nothing. */
export function wear(ledger: Ledger, item: ShopItem): { ledger: Ledger } | { error: string } {
  if (!owns(ledger, item)) return { error: tr(`You don't own ${item.name} yet, it's ${item.price} coins: ${cmd()} buy ${item.id}`, `${item.name} még nincs meg, ${item.price} garas: ${cmd()} buy ${item.id}`) }
  if (mode() === 'fukarlec') return { ledger: { ...ledger, fukarlec: { ...ledger.fukarlec, [item.kind]: item.id } } }
  return { ledger: item.kind === 'skin' ? { ...ledger, skin: item.id } : { ...ledger, pack: item.id } }
}

/**
 * Frugalitas' ledger with the one an old Fukarléc install exported folded in. Both read the same LiteLLM days,
 * so a day both credited counts once; purchases add up, and Fukarléc's outfit becomes Fukarléc mode's.
 */
export function mergeFukarlec(own: Ledger, hu: Ledger): Ledger {
  const maxed = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a }
    for (const [d, xp] of Object.entries(b)) out[d] = Math.max(xp, out[d] ?? 0)
    return out
  }
  return {
    ...own,
    since: hu.since < own.since ? hu.since : own.since,
    days: maxed(own.days, hu.days),
    quests: maxed(own.quests, hu.quests),
    spent: own.spent + hu.spent,
    owned: [...new Set([...own.owned, ...hu.owned])],
    fukarlec: { skin: hu.skin, pack: hu.pack },
  }
}

/**
 * Two ledgers of the same mode (Claude Code's and opencode's) as one. Both credit the same LiteLLM days, so a day
 * either credited counts once (the larger value); purchases are the union, and what they cost is recomputed from
 * `priceOf` (a key like `skin:pirate`), so nothing is charged twice. Ledger `a` keeps its outfit.
 */
export function mergeLedgers(a: Ledger, b: Ledger, priceOf: (key: string) => number): Ledger {
  const maxed = (x: Record<string, number>, y: Record<string, number>) => {
    const out = { ...x }
    for (const [d, xp] of Object.entries(y)) out[d] = Math.max(xp, out[d] ?? 0)
    return out
  }
  const owned = [...new Set([...a.owned, ...b.owned])]
  return {
    ...a,
    since: b.since < a.since ? b.since : a.since,
    days: maxed(a.days, b.days),
    quests: maxed(a.quests, b.quests),
    owned,
    spent: owned.reduce((n, key) => n + priceOf(key), 0),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

/** What the current mode wears. */
export function worn(ledger: Ledger): { skin: string; pack: string } {
  return mode() === 'fukarlec' ? ledger.fukarlec : { skin: ledger.skin, pack: ledger.pack }
}

/** `▰▰▰▱▱▱` progress text. */
export function progressBar(ratio: number, width = 12): string {
  const n = Math.max(0, Math.min(width, Math.round(ratio * width)))
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}
