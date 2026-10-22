/** @jsxImportSource @opentui/solid */
// The mascot in half-block cells; the cell maths is in mascot-cells.ts.
import { mascotMood } from '../hooks/mascot'
import type { Skin } from '../hooks/mascot'
import { mascotCells } from './mascot-cells'

export function Mascot(props: { skin: Skin; ratio: number | undefined; scale: 1 | 2; backdrop: string | undefined }) {
  const rows = () => mascotCells(props.skin, mascotMood(props.ratio), props.scale)
  return (
    // Centered, with the card just wider than the sprite. The sprite is mostly dark (coats, hats), so a lighter
    // card behind it keeps it from sinking into the sidebar.
    <box flexDirection="column" alignItems="center">
      <box flexDirection="column" paddingLeft={2} paddingRight={2} {...(props.backdrop ? { backgroundColor: props.backdrop } : {})}>
        {rows().map(row => (
          <text>
            {row.map(c => (
              <span style={{ fg: c.fg, bg: c.bg }}>{c.ch}</span>
            ))}
          </text>
        ))}
      </box>
    </box>
  )
}
