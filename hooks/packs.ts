import type { MascotMood } from './mascot'
import { type Mode, mode } from './mode'

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

// --- Fukarléc mode ------------------------------------------------------------

const paraszt: Pack = {
  id: 'paraszt',
  name: 'Fukar bácsi',
  description: 'Az eredeti tanyasi bölcsességek.',
  price: 0,
  warn: [
    '🧐 Lassan a testtel! A {scope} keret {pct}%-a elment.',
    '🤨 Fukar bácsi szemöldöke felszaladt: {scope} keret {pct}%.',
    '🪙 Számolj csak utána: a {scope} keretből {pct}% már a LiteLLM-é.',
  ],
  over: [
    '💀 Elfogyott a {scope} keret ({spent}/{budget}). Ennyiből: {kind}',
    '🔥 A {scope} keret ég! {spent} – a nagymamád ezt nem hagyná szó nélkül.',
    '🚨 {scope} keret túllépve: {spent}/{budget}. Fukar bácsi a szívéhez kap.',
  ],
  turn: ['💸 Ez a kör +{cost} volt ({kind}). Megérte?'],
  xp: ['🪙 +{xp} garas a tegnapi fukarkodásért!', '🌾 Jó termés volt tegnap: +{xp} garas.'],
  tipIntro: ['Hallgass rám, fiam: ', 'Okos gazda így tenne: ', ''],
  sayings: {
    calm: [
      'Így kell ezt, fiam. Garast a garasra!',
      'Szép csendesen, ahogy a Tisza folyik.',
      'Aki a tokent nem becsüli, a dollárt nem érdemli.',
    ],
    worried: [
      'Hékás! Fogy a keret, mint nyáron a jég.',
      'Nem lesz ebből jó, ha így megy tovább...',
      'Ennyiért már a szomszéd tehenét is megvehetném.',
    ],
    angry: [
      'Az ántivilágban ennyiből egész tanyát vettünk!',
      'Teringettét! Elfogyott a keret!',
      'Mán megint az Opus? Hát mi vagyok én, Rotschild?',
    ],
  },
}

const nagymama: Pack = {
  id: 'nagymama',
  name: 'Nagymama',
  description: 'Aggódó szeretet, rántott hús és lelkiismeret-furdalás.',
  price: 60,
  warn: [
    '👵 Kisfiam, a {scope} keret {pct}%-a elment. Ettél már?',
    '🍲 {pct}%... ennyiből egy hétre főztem volna, csillagom.',
    '🧶 Ne haragudj, de a {scope} keret már {pct}%-on áll.',
  ],
  over: [
    '😢 Elfogyott a {scope} keret ({spent}). Nem ezért neveltelek.',
    '🥟 {spent}! Ennyiből {kind}. Gyere haza, főzök inkább.',
    '📞 Felhívom anyádat. {scope} keret: {spent}/{budget}.',
  ],
  turn: ['🍪 +{cost} egy körre? Abból sütöttem volna egy tálca pogácsát.'],
  xp: ['🍰 +{xp} garas, mert tegnap spóroltál. Büszke vagyok rád, kincsem!'],
  tipIntro: ['Kisfiam, ', 'Csillagom, egy jó tanács: ', 'Ne haragudj, de '],
  sayings: {
    calm: ['Jól van, kincsem, okosan csinálod.', 'Egyél még egy kis rétest!', 'Látod, így kell beosztani.'],
    worried: ['Kisfiam, nem költesz te túl sokat?', 'Jaj, csak meg ne fázz... meg túl ne költs.', 'Anyád is mindig így kezdte.'],
    angry: [
      'Ennyi pénzből fél disznót vettünk volna!',
      'Ezt még a nagyapád se csinálta, pedig ő ivott!',
      'Hát erre tanítottalak én?',
    ],
  },
}

const nav: Pack = {
  id: 'nav',
  name: 'NAV-ellenőr',
  description: 'Hivatalos, rideg, iktatószámmal.',
  price: 120,
  warn: [
    '📋 Értesítjük, hogy {scope} keretének {pct}%-a felhasználásra került.',
    '🗂️ Ügyiratszám: FL/{pct}. A {scope} keret {pct}%-on áll.',
    '🧾 Felhívjuk figyelmét: {scope} keret {pct}%. Kérjük, tartsa be.',
  ],
  over: [
    '⚖️ Hiánypótlásra felszólítjuk: {scope} keret {spent}/{budget}.',
    '🏛️ Határozat: {scope} keret túllépve ({spent}). Fellebbezésnek helye nincs.',
    '📬 Tértivevényes levél: {spent} költés, {budget} keret. Jelentkezzen.',
  ],
  turn: ['🧾 Egyedi tétel rögzítve: +{cost}. Bizonylatot kérünk.'],
  xp: ['📄 Adójóváírás: +{xp} garas. Megőrzési idő: 8 év.'],
  tipIntro: ['Hatósági javaslat: ', 'Ellenőrzési megállapítás: ', 'Felhívjuk figyelmét: '],
  sayings: {
    calm: ['Az ügyfél adatai rendben.', 'Bevallás határidőben beérkezett.', 'Nincs további teendő.'],
    worried: ['Az ügyet felülvizsgálatra kijelöltük.', 'Kérjük, tartsa kéznél a bizonylatokat.', 'Szúrópróbaszerű ellenőrzés várható.'],
    angry: ['Mulasztási bírság kiszabva.', 'Az ügyet átadtuk a végrehajtónak.', 'Önellenőrzést javaslunk. Most.'],
  },
}

const betyar: Pack = {
  id: 'betyar',
  name: 'Betyár',
  description: 'Rózsa Sándor módra: a gazdagtól (az Opustól) elvesz.',
  price: 90,
  warn: [
    '🐎 Hej, komám! A {scope} keret {pct}%-a már elporzott.',
    '🔫 Megállj! {scope} keret {pct}%. A pandúrok már szimatolnak.',
    '🌾 {pct}%... a csárdában már suttognak rólad.',
  ],
  over: [
    '🪢 Elkaptak a pandúrok: {scope} keret {spent}/{budget}!',
    '🏴 A {scope} keret odavan ({spent}). Futás a nádasba!',
    '⛓️ {spent}! Ennyit még Sobri Jóska se rabolt egy éjjel.',
  ],
  turn: ['🐴 +{cost} egy körért? Ennyiért lovat lopok, nem tokent!'],
  xp: ['💰 +{xp} garas zsákmány a tegnapi portyáról!'],
  tipIntro: ['Hallod-e, komám: ', 'Betyárbecsületre: ', 'Súgom, mint betyár a betyárnak: '],
  sayings: {
    calm: ['Szabad a puszta, tele a tarisznya.', 'Gazdagtól veszek, szegénynek adok.', 'Ma nem kell bujdosni.'],
    worried: ['Hallom a pandúrok lovát...', 'Kevés már a tallér a tarisznyában.', 'Ideje lesz a nádasba húzódni.'],
    angry: ['Nem rabolok én, csak az Opus vesz el mindent!', 'A betyárbecsületre, ez sok!', 'Ennyit a vármegye se szed!'],
  },
}

const kocsmai: Pack = {
  id: 'kocsmai',
  name: 'Kocsmai',
  description: 'Pultnál támasztott bölcsességek, fröccsben mérve.',
  price: 60,
  warn: [
    '🍺 Komám, a {scope} keret {pct}%-a már lecsúszott.',
    '🍷 {pct}%? Ez már a harmadik fröccs után is sok.',
    '🎯 Csapos! A {scope} keret {pct}%-on áll, írd fel.',
  ],
  over: [
    '🍻 Elfogyott a {scope} keret! {spent}-ból egy hétig fizettem volna a kört.',
    '🥴 {spent}/{budget}... Zárás van, komám, nincs több hitel.',
    '🍺 Ennyiből {kind}. És te tokenre költötted.',
  ],
  turn: ['🍺 +{cost} egy körért? Ennyiért az egész kocsmának fizetek egyet!'],
  xp: ['🍻 +{xp} garas! Tegnap józanul költöttél, egészségedre!'],
  tipIntro: ['Figyu, komám: ', 'Mondom én a pultnál: ', 'Igyunk rá, de előbb: '],
  sayings: {
    calm: ['Egy kis fröccs, egy kis kód, így szép az élet.', 'Jó a hangulat, olcsó a kör.', 'Ma még én fizetek.'],
    worried: ['Komám, kezd nőni a cetli a pult alatt...', 'Lassan a kocsmáros is ránk néz.', 'Még egy kör, aztán haza.'],
    angry: ['Kitiltottak a kocsmából, akkora a cetli!', 'Ennyiért már a kocsmát is megvettem volna!', 'Zárórát mondok, komám!'],
  },
}

/** Each mode's message packs, its free default first. */
export const PACKS_BY_MODE: Readonly<Record<Mode, readonly Pack[]>> = {
  frugalitas: [miser, grandma, bartender, buccaneer, auditor],
  fukarlec: [paraszt, nagymama, betyar, kocsmai, nav],
}

export const PACKS: readonly Pack[] = [...PACKS_BY_MODE.frugalitas, ...PACKS_BY_MODE.fukarlec]

/** The message packs of the current mode. */
export const modePacks = (): readonly Pack[] => PACKS_BY_MODE[mode()]

export const packById = (id: string | undefined): Pack => modePacks().find(p => p.id === id) ?? modePacks()[0]!

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
  const isName = /^(Opus|Sonnet|Haiku|Claude|LiteLLM|NAV|I|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(firstWord)
  const lowered = !isName && /^[A-ZÁÉÍÓÖŐÚÜŰ]([a-záéíóöőúüű]|\s)/.test(text!) ? text!.charAt(0).toLowerCase() + text!.slice(1) : text!
  return `${emoji} ${intro}${lowered}`
}
