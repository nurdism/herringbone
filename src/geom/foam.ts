import { Hull } from './hull'
import type { Frame, Part } from './frame'
import { V2, poly, v2, clamp, signedArea } from './vec'

/**
 * Foam blocks that fill the bays between the ribs.
 *
 * Each bay is divided into compartments by the longitudinal panels. For every
 * compartment we take the cross section at whichever of its two ribs is the
 * smaller, pull it in by the clearance, and emit enough layers of your foam
 * sheet to fill the gap between the ribs. Cut the layers, laminate them, then
 * sand the block back until it drops in: the small end of a bay is never quite
 * the same shape as the big end, and no flat pattern can be.
 */

interface Compartment {
  from: number
  to: number
  outline: V2[]
  area: number
  centre: V2
  height: number
}

/** The clear space in one compartment of a station, as a closed outline. */
function compartmentAt(h: Hull, x: number, y0: number, y1: number, clear: number): Compartment | null {
  const p = h.p
  const sec = h.section(h.uOf(x))
  const hw = Math.max(1e-6, sec.halfWidth)
  const lo = (y: number) => h.hullZ(sec, clamp(Math.abs(y) / hw, 0, 1)) + p.skinThickness + clear
  const hi = (y: number) => h.deckZ(sec, clamp(Math.abs(y) / hw, 0, 1)) - p.skinThickness - clear

  const steps = 40
  const top: V2[] = []
  const bot: V2[] = []
  const minH = Math.max(4, p.foamThickness * 0.3)
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps
    const zl = lo(y)
    const zh = hi(y)
    if (zh - zl < minH) {
      // the compartment has run out into the rail, so stop the block there
      if (top.length < 2) continue
      break
    }
    top.push(v2(y, zh))
    bot.push(v2(y, zl))
  }
  if (top.length < 3) return null
  const midIdx = Math.floor(top.length / 2)
  const centre = v2(top[midIdx].x, (top[midIdx].y + bot[midIdx].y) / 2)
  const height = top[midIdx].y - bot[midIdx].y
  bot.reverse()
  const outline = top.concat(bot)
  const area = Math.abs(signedArea(outline))
  if (area < 400) return null // under 4 cm2 is not worth cutting
  return { from: top[0].x, to: top[top.length - 1].x, outline, area, centre, height }
}

export function buildFoamBlocks(h: Hull, frame: Frame): Part[] {
  const p = h.p
  if (!p.foamInserts) return []
  const clear = p.foamClearance
  const half = p.plyThickness / 2
  const parts: Part[] = []

  for (let b = 0; b < frame.stations.length - 1; b++) {
    const xa = frame.stations[b]
    const xb = frame.stations[b + 1]
    const gap = xb - xa - p.plyThickness - 2 * clear
    if (gap < p.foamThickness * 0.5) continue
    const layers = Math.max(1, Math.round(gap / p.foamThickness))

    // Compartment walls are the spines that reach this bay. With an even spine
    // count there is nothing on the centreline, so the innermost compartment
    // straddles it and is a single block rather than a mirrored pair.
    const walls = frame.longitudinals
      .filter((l) => l.y >= 0 && xa >= l.x0 && xb <= l.x1)
      .map((l) => l.y)
      .sort((m, n) => m - n)
    if (!walls.length) continue
    const openMiddle = walls[0] > 0
    const hwMin = Math.min(h.halfWidth(h.uOf(xa)), h.halfWidth(h.uOf(xb)))
    const outer = hwMin - p.skinThickness - clear

    for (let c = openMiddle ? -1 : 0; c < walls.length; c++) {
      // c === -1 is the block that spans the open middle, wall to wall
      const spans = c < 0
      const y0 = spans ? -(walls[0] - half - clear) : walls[c] + half + clear
      const y1 = spans ? walls[0] - half - clear : c + 1 < walls.length ? walls[c + 1] - half - clear : outer
      if (y1 - y0 < 12) continue

      // use whichever end of the bay is smaller, so the block fits both
      const A = compartmentAt(h, xa, y0, y1, clear)
      const B = compartmentAt(h, xb, y0, y1, clear)
      const pick = !A ? B : !B ? A : A.area <= B.area ? A : B
      if (!pick) continue

      const tag = spans ? 'm' : String(c + 1)
      parts.push({
        id: `foam-b${String(b + 1).padStart(2, '0')}-c${tag}`,
        kind: 'foam',
        label: `F${b + 1}.${tag.toUpperCase()}`,
        poly: poly(pick.outline),
        labelMark: {
          at: pick.centre,
          text: '',
          size: Math.max(2.5, Math.min(10, pick.height * 0.35, (pick.to - pick.from) * 0.12)),
          align: 'center',
        },
        thickness: p.foamThickness,
        qty: spans ? layers : layers * 2, // the middle block is not mirrored
        station: (xa + xb) / 2,
        meta: {
          bay: b + 1,
          compartment: tag,
          between_ribs: `R${b + 1}-R${b + 2}`,
          layers_per_side: layers,
          stack_mm: Math.round(layers * p.foamThickness * 10) / 10,
          bay_gap_mm: Math.round(gap * 10) / 10,
          area_cm2: Math.round(pick.area / 10) / 10,
          note: layers * p.foamThickness > gap ? 'sand the stack down to the gap' : 'shim or sand to suit',
        },
      })
    }
  }
  return parts
}
