// Frugalitas has two modes with one engine: Frugalitas (English, Old Penny, USD) and
// Fukarléc (Hungarian, Fukar bácsi, HUF). The mode only changes words, characters and
// currency; budgets, coins and every calculation stay the same.

export type Mode = 'frugalitas' | 'fukarlec'

export const MODES: readonly Mode[] = ['frugalitas', 'fukarlec']

let current: Mode = 'frugalitas'

export const mode = (): Mode => current

export function setMode(next: Mode): void {
  current = next
}

export const asMode = (value: unknown): Mode | undefined =>
  value === 'frugalitas' || value === 'fukarlec' ? value : undefined

/** The text of the current mode: `tr('cache expired', 'cache lejárt')`. */
export const tr = <T>(frugalitas: T, fukarlec: T): T => (current === 'fukarlec' ? fukarlec : frugalitas)

/** The mode's own slash command, as the texts name it. */
export const cmd = (): string => tr('/frugal', '/fukarlec')
