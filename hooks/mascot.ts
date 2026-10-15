import { uint32ToBase64 } from './format'

// A pane mascot drawn in half-block glyphs: two pixels in one terminal cell,
// so a 24×44 pixel sprite is 24 columns × 22 rows. Each skin is its own file
// under ./skins: a palette, the calm sprite, and the edits for its moods.

export type MascotMood = 'calm' | 'worried' | 'angry'

/** `[row, column, text]`: `text` written over the sprite from that pixel on, `.` transparent. */
export type Edit = readonly [row: number, col: number, text: string]

export type Skin = {
  id: string
  name: string
  description: string
  /** Garas (XP) it costs in the shop; 0 = owned from the start. */
  price: number
  /** One character per color, `0xRRGGBB`; `.` is transparent. */
  palette: Readonly<Record<string, number>>
  /** The calm sprite: MASCOT_PIXEL_ROWS strings of MASCOT_COLUMNS characters. */
  rows: readonly string[]
  worried: readonly Edit[]
  angry: readonly Edit[]
  /** Palette overrides while angry (a red face). */
  angryRecolor: Readonly<Record<string, number>>
}

const DEFAULT = 0x01000000

export const MASCOT_COLUMNS = 24
export const MASCOT_PIXEL_ROWS = 44
export const MASCOT_ROWS = MASCOT_PIXEL_ROWS / 2

/** The sprite for a mood: the calm rows with that mood's edits applied. */
export function mascotPixels(skin: Skin, mood: MascotMood): string[] {
  const rows = [...skin.rows]
  const edits = mood === 'worried' ? skin.worried : mood === 'angry' ? skin.angry : []
  for (const [y, x, text] of edits) {
    const row = rows[y]!
    rows[y] = row.slice(0, x) + text + row.slice(x + text.length)
  }
  return rows
}

function colorAt(skin: Skin, rows: string[], mood: MascotMood, x: number, y: number): number {
  const ch = rows[y]?.[x] ?? '.'
  if (ch === '.') return DEFAULT
  if (mood === 'angry' && skin.angryRecolor[ch] !== undefined) return skin.angryRecolor[ch]!
  return skin.palette[ch] ?? DEFAULT
}

/** Raster cells: `▀` painted with the upper pixel as foreground and the lower one as background. */
export function mascotRasterCells(skin: Skin, mood: MascotMood): string {
  const rows = mascotPixels(skin, mood)
  const words = new Uint32Array(MASCOT_COLUMNS * MASCOT_ROWS * 3)
  for (let cy = 0; cy < MASCOT_ROWS; cy++) {
    for (let x = 0; x < MASCOT_COLUMNS; x++) {
      const top = colorAt(skin, rows, mood, x, cy * 2)
      const bottom = colorAt(skin, rows, mood, x, cy * 2 + 1)
      const base = (cy * MASCOT_COLUMNS + x) * 3
      if (top === DEFAULT && bottom === DEFAULT) words.set([0x20, DEFAULT, DEFAULT], base)
      else if (top === DEFAULT) words.set([0x2584, bottom, DEFAULT], base) // ▄
      else words.set([0x2580, top, bottom], base) // ▀
    }
  }
  return uint32ToBase64(words)
}

export function mascotMood(ratio: number | undefined): MascotMood {
  if (ratio === undefined || ratio < 0.75) return 'calm'
  if (ratio < 1) return 'worried'
  return 'angry'
}
