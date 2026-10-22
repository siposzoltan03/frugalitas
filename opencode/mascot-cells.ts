// The mascot as half-block cells (▀ ▄): two pixels per terminal cell, like the Claude Code pane's raster.
import { mascotPixels } from '../hooks/mascot'
import type { MascotMood, Skin } from '../hooks/mascot'

export type Cell = { ch: string; fg?: string; bg?: string }

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/** The sprite's color per pixel (undefined = transparent), with the mood's edits and recolor applied. */
function pixelColors(skin: Skin, mood: MascotMood): (string | undefined)[][] {
  return mascotPixels(skin, mood).map(row =>
    [...row].map(ch => {
      if (ch === '.') return undefined
      const c = (mood === 'angry' ? skin.angryRecolor[ch] : undefined) ?? skin.palette[ch]
      return c === undefined || c === 0x01000000 ? undefined : hex(c)
    }),
  )
}

/** `scale` 1: every pixel (24 columns × 22 rows); 2: 2×2 pixels merged into one (12 columns × 11 rows). */
export function mascotCells(skin: Skin, mood: MascotMood, scale: 1 | 2): Cell[][] {
  const px = pixelColors(skin, mood)
  const w = px[0]?.length ?? 0
  /** One logical pixel: the most common opaque color among the `scale`×`scale` block. */
  const at = (x: number, y: number): string | undefined => {
    const seen = new Map<string, number>()
    let opaque = 0
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const c = px[y * scale + dy]?.[x * scale + dx]
        if (c) {
          opaque++
          seen.set(c, (seen.get(c) ?? 0) + 1)
        }
      }
    }
    if (opaque === 0) return undefined // any opaque pixel counts: thin parts (cane, hat brim, glasses) must survive the merge
    return [...seen].sort((a, b) => b[1] - a[1])[0]![0]
  }
  const rows: Cell[][] = []
  const logicalRows = Math.floor(px.length / scale)
  for (let cy = 0; cy < logicalRows; cy += 2) {
    const row: Cell[] = []
    for (let x = 0; x < Math.floor(w / scale); x++) {
      const top = at(x, cy)
      const bottom = at(x, cy + 1)
      if (!top && !bottom) row.push({ ch: ' ' })
      else if (!top) row.push({ ch: '▄', fg: bottom })
      else row.push({ ch: '▀', fg: top, ...(bottom ? { bg: bottom } : {}) })
    }
    rows.push(row)
  }
  return rows
}
