import type { MascotMood } from './mascot'

// Message packs: who is talking in the toasts and in the pane's speech bubble.
// Placeholders: {scope} (session/daily/monthly), {pct}, {spent}, {budget}, {cost},
// {kind} ("≈ 3 coffees ☕"), {xp}. Keep them short: a toast is one line.

export type Pack = {
  id: string
  name: string
  description: string
  /** Garas (XP) it costs in the shop; 0 = owned from the start. */
  price: number
  /** A budget crossed 80%. */
  warn: readonly string[]
  /** A budget used up. */
  over: readonly string[]
  /** One expensive turn. */
  turn: readonly string[]
  /** XP credited for yesterday's thrift. */
  xp: readonly string[]
  /** Said before a savings tip, so tips speak in the pack's voice; '' leaves the tip as is. */
  tipIntro: readonly string[]
  /** The pane's speech bubble, by the mascot's mood. */
  sayings: Readonly<Record<MascotMood, readonly string[]>>
}

const miser: Pack = {
  id: 'miser',
  name: 'Old Penny',
  description: 'The original grumbling miser.',
  price: 0,
  warn: [
    '🧐 Steady now! {pct}% of the {scope} budget is gone.',
    '🤨 Old Penny raises an eyebrow: {scope} budget at {pct}%.',
    '🪙 Count it yourself: {pct}% of the {scope} budget already belongs to LiteLLM.',
  ],
  over: [
    '💀 The {scope} budget is gone ({spent}/{budget}). That would have bought: {kind}',
    '🔥 The {scope} budget is on fire! {spent} — and not a penny of it back.',
    '🚨 {scope} budget exceeded: {spent}/{budget}. Old Penny clutches his chest.',
  ],
  turn: ['💸 That turn cost +{cost} ({kind}). Worth it?'],
  xp: ['🪙 +{xp} coins for yesterday\'s thrift!', '💰 A fine harvest yesterday: +{xp} coins.'],
  tipIntro: ['Listen to an old miser: ', 'A sensible saver would know: ', ''],
  sayings: {
    calm: ['A penny saved is a penny earned.', 'Quiet and thrifty, just how I like it.', 'Mind the tokens and the dollars mind themselves.'],
    worried: ['Hm. The budget melts like ice in July.', 'This will end badly if it goes on...', 'For this money I could buy a second ledger.'],
    angry: ['In my day this bought a whole house!', 'Blast it! The budget is gone!', 'Opus again? Do I look like a bank?'],
  },
}

const grandma: Pack = {
  id: 'grandma',
  name: 'Grandma',
  description: 'Loving worry, cookies and a little guilt.',
  price: 60,
  warn: [
    '👵 Sweetie, {pct}% of the {scope} budget is gone. Have you eaten?',
    '🍲 {pct}%... I could have cooked for a week with that, dear.',
    '🧶 Don\'t be cross, but the {scope} budget is at {pct}%.',
  ],
  over: [
    '😢 The {scope} budget is gone ({spent}). I didn\'t raise you for this.',
    '🥧 {spent}! That would have bought {kind}. Come home, I\'ll cook.',
    '📞 I\'m calling your mother. {scope} budget: {spent}/{budget}.',
  ],
  turn: ['🍪 +{cost} for one turn? That\'s a whole tray of cookies.'],
  xp: ['🍰 +{xp} coins for saving yesterday. I\'m so proud of you, darling!'],
  tipIntro: ['Sweetie, ', 'A little advice, dear: ', 'Don\'t be cross, but '],
  sayings: {
    calm: ['That\'s my clever one.', 'Have another slice of pie!', 'See? That\'s how you budget.'],
    worried: ['Aren\'t you spending a bit much, dear?', 'Wrap up warm... and don\'t overspend.', 'Your mother started like this too.'],
    angry: ['We fed a family of six on that!', 'Even your grandfather never did this!', 'Is this what I taught you?'],
  },
}

const bartender: Pack = {
  id: 'bartender',
  name: 'Bartender',
  description: 'Wisdom from behind the bar, measured in pints.',
  price: 60,
  warn: [
    '🍺 Easy, pal — {pct}% of the {scope} budget is down the hatch.',
    '🍷 {pct}%? That\'s a lot even after the third round.',
    '🎯 {scope} budget at {pct}%. I\'m putting it on your tab.',
  ],
  over: [
    '🍻 The {scope} budget is gone! {spent} would have bought the whole bar a round.',
    '🥴 {spent}/{budget}... Last orders, pal. No more credit.',
    '🍺 That would have bought {kind}. And you spent it on tokens.',
  ],
  turn: ['🍺 +{cost} for one turn? For that I\'d buy the whole pub a round!'],
  xp: ['🍻 +{xp} coins! You spent soberly yesterday — cheers!'],
  tipIntro: ['Word from the bar, pal: ', 'Take it from a bartender: ', 'Before the next round: '],
  sayings: {
    calm: ['A quiet pint and some code — that\'s the life.', 'Good mood, cheap rounds.', 'This one\'s on the house.'],
    worried: ['Pal, the tab under the counter is getting long...', 'The landlord is starting to look over.', 'One more round, then home.'],
    angry: ['You\'re barred — look at the size of that tab!', 'For that I\'d have bought the pub!', 'Closing time, pal!'],
  },
}

const buccaneer: Pack = {
  id: 'buccaneer',
  name: 'Buccaneer',
  description: 'Arr — guard the treasure from the Opus kraken.',
  price: 90,
  warn: [
    '🏴‍☠️ Arr! {pct}% of the {scope} treasure is already overboard.',
    '⚓ Avast! {scope} budget at {pct}%. The navy is on our trail.',
    '🦜 {pct}%... the parrot is starting to squawk about it.',
  ],
  over: [
    '☠️ The {scope} treasure is gone: {spent}/{budget}! Abandon ship!',
    '🌊 The {scope} budget sank ({spent}). Walk the plank!',
    '⛓️ {spent}! Not even Blackbeard plundered that much in a night.',
  ],
  turn: ['🦜 +{cost} for one turn? I could buy a ship for that, not tokens!'],
  xp: ['💰 +{xp} coins of loot from yesterday\'s raid!'],
  tipIntro: ['Listen here, matey: ', 'Pirate\'s honour: ', 'Between you and me and the parrot: '],
  sayings: {
    calm: ['Fair winds and a full chest.', 'Not a doubloon wasted today.', 'Smooth sailing, matey.'],
    worried: ['I hear the navy\'s cannons...', 'The treasure chest is getting light.', 'Time to hide in a quiet cove.'],
    angry: ['I\'m not the thief here, it\'s the Opus kraken!', 'By my wooden leg, that\'s too much!', 'Not even the Crown taxes like this!'],
  },
}

const auditor: Pack = {
  id: 'auditor',
  name: 'The Auditor',
  description: 'Official, cold, with a reference number.',
  price: 120,
  warn: [
    '📋 Please be advised that {pct}% of your {scope} budget has been used.',
    '🗂️ Case ref. PP/{pct}: the {scope} budget stands at {pct}%.',
    '🧾 Reminder: {scope} budget {pct}%. Compliance is expected.',
  ],
  over: [
    '⚖️ Notice of deficiency: {scope} budget {spent}/{budget}.',
    '🏛️ Ruling: {scope} budget exceeded ({spent}). No appeal is possible.',
    '📬 Registered letter: {spent} spent against a {budget} budget. Please report.',
  ],
  turn: ['🧾 Line item recorded: +{cost}. Please attach a receipt.'],
  xp: ['📄 Tax credit: +{xp} coins. Retention period: 7 years.'],
  tipIntro: ['Official recommendation: ', 'Audit finding: ', 'Please note: '],
  sayings: {
    calm: ['Your records are in order.', 'Filing received on time.', 'No further action required.'],
    worried: ['Your case has been flagged for review.', 'Please keep your receipts at hand.', 'A random audit is likely.'],
    angry: ['A penalty has been assessed.', 'Your case has been referred to collections.', 'We recommend self-correction. Now.'],
  },
}

export const PACKS: readonly Pack[] = [miser, grandma, bartender, buccaneer, auditor]

export const packById = (id: string | undefined): Pack => PACKS.find(p => p.id === id) ?? miser

/** Fill `{name}` placeholders; an unknown name is left as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (values[name] !== undefined ? String(values[name]) : all))
}

export function pickLine(list: readonly string[], seed: number): string {
  return list[Math.abs(Math.floor(seed)) % list.length]!
}

/** A tip (`<emoji> <text>`) in the pack's voice: the emoji, an intro, then the text. */
export function voice(tip: string, pack: Pack, seed: number): string {
  const intro = pack.tipIntro.length > 0 ? pickLine(pack.tipIntro, seed) : ''
  if (!intro) return tip
  const match = /^(\S+)\s+(.*)$/su.exec(tip)
  if (!match) return intro + tip
  const [, emoji, text] = match
  const firstWord = text!.split(/\s/, 1)[0]!
  const isName = /^(Opus|Sonnet|Haiku|Claude|LiteLLM|I|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(firstWord)
  const lowered = !isName && /^[A-Z]([a-z]|\s)/.test(text!) ? text!.charAt(0).toLowerCase() + text!.slice(1) : text!
  return `${emoji} ${intro}${lowered}`
}
