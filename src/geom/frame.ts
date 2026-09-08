import { Hull } from './hull'
import { spineOffsets } from '../params'
import { minPlankBand } from '../params'
import { Poly, V2, poly, v2, clamp, offsetPolygon, ensureCCW, pointInPolygon } from './vec'
import { strokeText } from './stroke'

/** A piece of text etched into a part. Kept upright however the part is nested. */
export interface Mark {
  at: V2
  /** Ignored for a part's label mark, which uses the part name. */
  text: string
  size: number
  align?: 'left' | 'center' | 'right'
  /** Where `at` sits in the text box. Defaults to the middle of the line. */
  vAlign?: 'baseline' | 'middle'
}

export type PartKind = 'rib' | 'stringer' | 'skin' | 'jig' | 'foam' | 'block'

export interface Part {
  id: string
  kind: PartKind
  label: string
  /**
   * Outline in the part's own design plane:
   *   rib      -> (y, z) at its station
   *   stringer -> (x, z) on its own vertical plane
   *   skin     -> flattened (along, across)
   */
  poly: Poly
  thickness: number
  qty: number
  /** Where a rib sits along the board. */
  station?: number
  /** Transverse offset of a longitudinal panel. 0 is the centreline. */
  offsetY?: number
  /** Which side of the board a mirrored skin strip belongs to. */
  side?: 1 | -1
  /** Polylines to score rather than cut: station marks, foot cut lines. */
  engrave?: V2[][]
  /** Text to etch into the part, in its own design plane. */
  marks?: Mark[]
  /** Where the part name is etched. Falls back to the bounding box centre. */
  labelMark?: Mark
  meta: Record<string, number | string>
}

/** One longitudinal panel position: the centre stringer plus any side stringers. */
export interface Longitudinal {
  y: number
  x0: number
  x1: number
  splits: number[]
}

export interface Frame {
  hull: Hull
  ribs: Part[]
  stringers: Part[]
  jigs: Part[]
  stations: number[]
  longitudinals: Longitudinal[]
  slotWidth: number
  x0: number
  x1: number
  splits: number[]
  ribsClampedToStringer: boolean
  /** How many of the ribs were added to close each end. */
  endRibCount: { tail: number; nose: number }
  /** Spacing of the evenly placed main ribs, ignoring the closer end ribs. */
  mainSpacing: number
  /**
   * Which stations each spine is slotted at, keyed by its unsigned offset.
   * This is the single record of where a half lap exists: the rib, the spine
   * and anything checking them all read it rather than deciding for themselves.
   */
  slotted: Map<number, Set<number>>
  /**
   * True when the ribs are slotted from the deck and the stringers from the
   * hull. That is the orientation the frame needs when it stands on rib feet
   * with the hull down: the stringers then rest on the ribs instead of hanging
   * out of them.
   */
  ribSlotFromTop: boolean
  /** Common height every rib foot reaches down to, or null when there are none. */
  footBaseZ: number | null
}

// ---------------------------------------------------------------- surfaces

/** How steeply the surface runs at a transverse offset, for perpendicular insets. */
function slopeFactor(f: (y: number) => number, y: number, step: number): number {
  const d = (f(y + step) - f(y - step)) / (2 * step)
  return Math.min(8, Math.sqrt(1 + d * d))
}

/**
 * Bottom of the frame on the vertical plane at transverse offset `y`.
 * The skin is taken off perpendicular to the surface, not straight down, so
 * this lands on the same place the rib's offset outline does.
 */
export function panelBottomZ(h: Hull, x: number, y: number): number {
  const sec = h.section(h.uOf(x))
  const hw = Math.max(1e-6, sec.halfWidth)
  const at = (q: number) => h.hullZ(sec, clamp(Math.abs(q) / hw, 0, 1))
  return at(y) + h.p.skinThickness * slopeFactor(at, y, hw / 200)
}

export function panelTopZ(h: Hull, x: number, y: number): number {
  const sec = h.section(h.uOf(x))
  const hw = Math.max(1e-6, sec.halfWidth)
  const at = (q: number) => h.deckZ(sec, clamp(Math.abs(q) / hw, 0, 1))
  return at(y) - h.p.skinThickness * slopeFactor(at, y, hw / 200)
}

/** Is the rail band deep enough here to carry a plank and a tenon? */
export function plankLive(h: Hull, x: number): boolean {
  if (!h.p.outerPlank) return false
  const sec = h.section(h.uOf(x))
  // The band is held at exactly this floor wherever the section allows, so the
  // comparison has to admit equality or the plank stops short of both tips.
  return sec.railHighZ - sec.railLowZ >= minPlankBand(h.p) - 1e-6
}

/**
 * The run of the board a rail plank covers, stopping short of both tips.
 * The band tapers away toward the nose and tail, so the plank has to end while
 * it still has a real section, and the ribs beyond it get no tenon.
 */
export function plankLimits(h: Hull): [number, number] | null {
  if (!h.p.outerPlank) return null
  const need = minPlankBand(h.p)
  const wide = (u: number) => {
    const sec = h.section(u)
    return sec.railHighZ - sec.railLowZ - need + 1e-6
  }
  const peak = h.p.widePoint
  if (wide(peak) <= 0) return null
  const solve = (from: number) => {
    let a = from
    let b = peak
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      if (wide(m) > 0) b = m
      else a = m
    }
    return (a + b) / 2
  }
  return [wide(0) > 0 ? 0 : h.xOf(solve(0)), wide(1) > 0 ? h.p.length : h.xOf(solve(1))]
}

/**
 * The flat rail band a plank sits in, and how much of it the tenon takes.
 *
 * Shared so the rib, the plank mesh and the mortises all agree: they are three
 * views of one joint and any disagreement between them is a gap in the wood.
 */
export function railSeat(h: Hull, x: number): { railZ: number; bandHalf: number; tenonHalf: number } | null {
  const p = h.p
  const sec = h.section(h.uOf(x))
  // keep the step inside the flat band, where the inset outline is vertical
  const bandHalf = Math.max(0, (sec.railHighZ - sec.railLowZ) / 2 - p.skinThickness)
  if (bandHalf <= 2) return null
  return { railZ: sec.railZ, bandHalf, tenonHalf: Math.min(p.ribTenonHeight, bandHalf * 1.5) / 2 }
}

/**
 * Is there a joint worth cutting where this rib crosses this spine?
 *
 * Both halves of every half lap ask this one question, so a rib can never
 * decline a slot that the spine has already cut for it, or the other way
 * round. Near the tips a spine runs out of width and depth long before the
 * centreline one does.
 */
export function jointLive(h: Hull, x: number, y: number): boolean {
  const p = h.p
  const sec = h.section(h.uOf(x))
  const slotHalf = (p.plyThickness + p.slotClearance) / 2
  if (Math.abs(y) + slotHalf > sec.halfWidth - p.skinThickness - 1) return false
  return panelTopZ(h, x, y) - panelBottomZ(h, x, y) >= p.plyThickness * 2
}

/** Where a rib and a longitudinal panel meet: half way up the local depth. */
export function panelMidZ(h: Hull, x: number, y: number): number {
  return (panelBottomZ(h, x, y) + panelTopZ(h, x, y)) / 2
}

export const frameBottomZ = (h: Hull, x: number) => panelBottomZ(h, x, 0)
export const frameTopZ = (h: Hull, x: number) => panelTopZ(h, x, 0)
export const slotMidZ = (h: Hull, x: number) => panelMidZ(h, x, 0)

// ---------------------------------------------------------------- splicing

/**
 * A notch or tab spliced into one edge of a closed outline, between the two
 * places the outline crosses `y0` and `y1`.
 */
interface EdgeFeature {
  y0: number
  y1: number
  edge: 'bottom' | 'top'
  /** Points between the crossing at the near end and the crossing at the far end. */
  build: (zNear: number, zFar: number) => V2[]
  /** Called with the two crossing points once they are known. */
  report?: (a: V2, b: V2) => void
}

/**
 * Rotate a loop so it starts at the widest point. Both the keel and the deck
 * centreline then sit mid array, so a feature at either never has to wrap.
 */
function rotateToWidest(loop: V2[]): V2[] {
  let best = 0
  for (let i = 1; i < loop.length; i++) if (loop[i].x > loop[best].x) best = i
  return loop.slice(best).concat(loop.slice(0, best))
}

/**
 * Splice features into a counter clockwise section outline.
 *
 * After rotating to the widest point the walk runs: widest point, deck to the
 * far side, round the far rail, along the hull back through the keel, up to
 * the start. So the deck is crossed with y decreasing and the hull with y
 * increasing, which is all we need to tell the two edges apart.
 */
function spliceFeatures(loop0: V2[], features: EdgeFeature[]): V2[] {
  if (!features.length) return loop0
  const loop = rotateToWidest(loop0)
  const n = loop.length

  // Order features the way the walk meets them: deck first, high y to low y,
  // then the hull, low y to high y.
  const order = features.slice().sort((a, b) => {
    if (a.edge !== b.edge) return a.edge === 'top' ? -1 : 1
    return a.edge === 'top' ? b.y1 - a.y1 : a.y0 - b.y0
  })

  const out: V2[] = []
  let fi = 0
  let openZ: number | null = null

  const zAt = (a: V2, b: V2, t: number) => a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x)

  for (let i = 0; i < n; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % n]
    if (openZ === null) out.push(a)

    // one edge can carry several features, so keep testing until none match
    for (;;) {
      if (fi >= order.length) break
      const f = order[fi]
      // deck features are met far end first, hull features near end first
      const near = f.edge === 'top' ? f.y1 : f.y0
      const far = f.edge === 'top' ? f.y0 : f.y1
      const forward = f.edge === 'bottom'

      if (openZ === null) {
        const hit = forward ? a.x <= near && b.x > near : a.x >= near && b.x < near
        if (!hit) break
        openZ = zAt(a, b, near)
        out.push(v2(near, openZ))
        continue
      }
      const hit = forward ? a.x < far && b.x >= far : a.x > far && b.x <= far
      if (!hit) break
      const zFar = zAt(a, b, far)
      out.push(...f.build(openZ, zFar), v2(far, zFar))
      f.report?.(v2(near, openZ), v2(far, zFar))
      openZ = null
      fi++
    }
  }
  return out
}

/**
 * Cut a step into both rails, or stand one proud of them.
 *
 * A positive depth lets a rebate in, for a rail strip or an outer plank to sit
 * flush. A negative depth pushes material out instead, which is how each rib
 * grows the tenon that plugs into the plank.
 *
 * The rail is the one edge the y based splice cannot reach, because the walk
 * crosses it in z rather than in y. It is a simple shape though: the outboard
 * edge is traversed upward on the +y side and downward on the -y side, so one
 * pass over the loop finds all four crossings.
 */
function rebateRails(loop: V2[], depth: number, zLo: number, zHi: number): V2[] {
  if (Math.abs(depth) <= 0.01 || zHi - zLo < 1) return loop
  const n = loop.length
  // Only the rail itself, not merely the outer half of the rib: a spine slot
  // sits well inboard but still dives through the same heights, and a looser
  // test picks it up and rebates everything between it and the rail.
  const railX = Math.max(...loop.map((q) => Math.abs(q.x)))
  const reach = Math.max(4 * Math.abs(depth), 15)
  // Either end of the edge being near the rail is enough: the edge that
  // carries the lower crossing already runs away inboard.
  const nearRail = (a: V2, b: V2) => Math.max(Math.abs(a.x), Math.abs(b.x)) > railX - reach
  const xAt = (a: V2, b: V2, z: number) => a.x + ((b.x - a.x) * (z - a.y)) / (b.y - a.y)

  const out: V2[] = []
  let skipping = false
  let entryX = 0
  for (let i = 0; i < n; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % n]
    if (!skipping) out.push(a)
    if (!nearRail(a, b)) continue
    const sign = a.x > 0 ? 1 : -1
    // +y is walked bottom to top, -y top to bottom
    const first = sign > 0 ? zLo : zHi
    const last = sign > 0 ? zHi : zLo
    const rising = sign > 0
    const crosses = (z: number) => (rising ? a.y <= z && b.y > z : a.y >= z && b.y < z)
    // Both crossings can fall on one edge: once a rail has already been
    // rebated, its whole outboard face is a single long segment. Test the exit
    // on the same edge rather than moving on, or the walk never closes and
    // everything after it is thrown away.
    if (!skipping && crosses(first)) {
      entryX = xAt(a, b, first)
      out.push(v2(entryX, first), v2(entryX - sign * depth, first))
      skipping = true
    }
    if (skipping && crosses(last)) {
      const x2 = xAt(a, b, last)
      out.push(v2(x2 - sign * depth, last), v2(x2, last))
      skipping = false
    }
  }
  // an unclosed step would leave a mangled outline, so fall back to the input
  return skipping ? loop : out
}

// ---------------------------------------------------------------- pockets

/**
 * A lightening hole that follows the shape of the pocket it sits in.
 *
 * `lo` and `hi` return the floor and ceiling of the available space. The web
 * is held **perpendicular** to those boundaries rather than measured straight
 * up and down: near a steep edge, such as a rib approaching its rail, a
 * vertical gap of 20 mm leaves only a few millimetres of actual material.
 * The requested span is then trimmed back to the longest run that still has
 * room, so a pocket that would run out simply stops short.
 */
function pocketHole(
  a0: number,
  a1: number,
  lo: (a: number) => number,
  hi: (a: number) => number,
  web: number,
  samples = 24,
  minHalfHeight = 4,
  fill = 1,
  round = 6,
): V2[] | null {
  if (a1 - a0 < web * 2) return null
  const step = Math.max(0.02, (a1 - a0) / 400)
  const insetLo = (a: number) => web * slopeFactor(lo, a, step)
  const insetHi = (a: number) => web * slopeFactor(hi, a, step)

  const probe = 160
  let bestA = 0
  let bestB = -1
  let runA = -1
  for (let i = 0; i <= probe; i++) {
    const a = a0 + ((a1 - a0) * i) / probe
    const ok = hi(a) - lo(a) >= insetLo(a) + insetHi(a) + 2 * minHalfHeight
    if (ok && runA < 0) runA = i
    if ((!ok || i === probe) && runA >= 0) {
      const runB = ok ? i : i - 1
      if (runB - runA > bestB - bestA) { bestA = runA; bestB = runB }
      runA = -1
    }
  }
  if (bestB <= bestA) return null
  const b0 = a0 + ((a1 - a0) * bestA) / probe
  const b1 = a0 + ((a1 - a0) * bestB) / probe
  if (b1 - b0 < web * 1.5) return null

  const mid = (b0 + b1) / 2
  const half = (b1 - b0) / 2
  const top: V2[] = []
  const bot: V2[] = []
  let maxHalfH = 0
  for (let i = 0; i <= samples; i++) {
    const t = -1 + (2 * i) / samples
    const a = mid + t * half
    // superellipse ends: a high `round` holds full height then turns off
    // sharply, a low one draws the cutout out into a long taper
    const e = fill * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), round)), 1 / 2.5)
    const zl = lo(a) + insetLo(a)
    const zh = hi(a) - insetHi(a)
    const c = (zl + zh) / 2
    const hh = Math.max(0, ((zh - zl) / 2) * e)
    maxHalfH = Math.max(maxHalfH, hh)
    top.push(v2(a, c + hh))
    bot.push(v2(a, c - hh))
  }
  if (maxHalfH < minHalfHeight) return null
  bot.reverse()
  return top.concat(bot)
}

// ---------------------------------------------------------------- ribs

interface RibContext {
  stations: number[]
  offsets: number[] // transverse offset of every longitudinal panel, 0 first
  slotFromTop: boolean
  footBaseZ: number | null
  /** jointNumber(ribIndex, |offset|) -> the number etched on both mating parts. */
  jointNumber: ((ribIndex: number, absY: number) => number) | null
  /**
   * Which station *indices* each spine is slotted at, keyed by unsigned offset.
   * Indices, not positions: a station round tripped through u and back drifts
   * by a fraction of a nanometre, and a lookup by value then silently misses,
   * leaving a rib with no slots and nothing holding it.
   */
  slotted: Map<number, Set<number>>
}

function buildRib(h: Hull, x: number, index: number, total: number, ctx: RibContext): Part {
  const p = h.p
  const u = h.uOf(x)
  const slotHalf = (p.plyThickness + p.slotClearance) / 2
  const sec = h.section(u)
  const hw = Math.max(1e-6, sec.halfWidth)
  const inset = ensureCCW(offsetPolygon(h.sectionOutline(u, 48), -p.skinThickness))
  const edge = ctx.slotFromTop ? 'top' : 'bottom'

  const features: EdgeFeature[] = []
  const engrave: V2[][] = []
  const marks: Mark[] = []
  const markSize = clamp(Math.min(p.webWidth * 0.55, (frameTopZ(h, x) - frameBottomZ(h, x)) * 0.16), 2.5, 11)

  // ---- half laps for every longitudinal panel that reaches this station ----
  const live: number[] = []
  for (const oy of ctx.offsets) {
    // the spine has to be slotted here too, or the rib gets a slot with
    // nothing to slot onto
    if (!ctx.slotted.get(Math.abs(oy))?.has(index)) continue
    const mid = panelMidZ(h, x, oy)
    live.push(oy)
    if (ctx.jointNumber) {
      marks.push({
        at: v2(oy + slotHalf + markSize * 0.5, ctx.slotFromTop ? mid - markSize * 0.8 : mid + markSize * 0.8),
        text: String(ctx.jointNumber(index, Math.abs(oy))),
        size: markSize,
        align: 'left',
      })
    }
    features.push({
      y0: oy - slotHalf,
      y1: oy + slotHalf,
      edge,
      build: () =>
        ctx.slotFromTop
          ? [v2(oy + slotHalf, mid), v2(oy - slotHalf, mid)]
          : [v2(oy - slotHalf, mid), v2(oy + slotHalf, mid)],
    })
  }

  // ---- sacrificial feet, always on the hull edge ----
  const footZ = ctx.footBaseZ
  if (footZ !== null && ctx.slotFromTop) {
    const fw = Math.min(p.footWidth, Math.max(6, hw * 0.3))
    const nick = Math.min(2.5, fw * 0.12)
    const blocked = live.map((oy) => [oy - slotHalf - fw / 2, oy + slotHalf + fw / 2] as const)
    // sit the feet well outboard for stability, clear of every slot
    let fc = hw * 0.5
    for (let tries = 0; tries < 24; tries++) {
      if (!blocked.some(([lo, hi]) => fc > lo && fc < hi)) break
      fc += hw * 0.03
    }
    if (fc + fw / 2 < hw - p.skinThickness - p.webWidth * 0.5 && fc - fw / 2 > slotHalf + 2) {
      for (const sign of [-1, 1] as const) {
        const c = sign * fc
        const y0 = c - fw / 2
        const y1 = c + fw / 2
        features.push({
          y0,
          y1,
          edge: 'bottom',
          build: (zNear, zFar) => [
            v2(y0 + nick, zNear - nick),
            v2(y0, zNear - 2 * nick),
            v2(y0, footZ),
            v2(y1, footZ),
            v2(y1, zFar - 2 * nick),
            v2(y1 - nick, zFar - nick),
          ],
          report: (a, b) => engrave.push([a, b]),
        })
      }
    }
  }

  // Rail work happens before the features are spliced in. Splicing rotates the
  // loop to start at the widest point, which is the rail itself, so the rail
  // region would straddle the array boundary and never close afterwards.
  let base = inset
  const seat = railSeat(h, x)
  if (p.railStrip && seat) {
    const half = Math.min(p.railStripHeight / 2, seat.bandHalf)
    base = rebateRails(base, p.railStripThickness - p.skinThickness, sec.railZ - half, sec.railZ + half)
  }
  if (p.outerPlank && seat && plankLive(h, x)) {
    // Set the rail back to the inside face of the plank, then grow a tenon out
    // through it. The tenon reaches the outer surface, to be trimmed flush.
    base = rebateRails(base, p.outerPlankThickness - p.skinThickness, seat.railZ - seat.bandHalf, seat.railZ + seat.bandHalf)
    base = rebateRails(base, -p.outerPlankThickness, seat.railZ - seat.tenonHalf, seat.railZ + seat.tenonHalf)
  }

  const outer = spliceFeatures(base, features)

  // ---- lightening pockets, divided into bays between the slots ----
  const holes: V2[][] = []
  if (p.lightenRibs && p.ribBays > 0) {
    const web = p.webWidth
    const loAt = (y: number) => h.hullZ(sec, clamp(Math.abs(y) / hw, 0, 1)) + p.skinThickness
    const hiAt = (y: number) => h.deckZ(sec, clamp(Math.abs(y) / hw, 0, 1)) - p.skinThickness
    const outerLimit = hw - p.skinThickness - web

    // obstacles on the +y side: the centreline slot and any side stringers
    const stops = [0, ...live.filter((oy) => oy > 0)].sort((a, b) => a - b)
    const spans: [number, number][] = []
    for (let i = 0; i < stops.length; i++) {
      const from = stops[i] + slotHalf + web
      const to = i + 1 < stops.length ? stops[i + 1] - slotHalf - web : outerLimit
      if (to > from) spans.push([from, to])
    }

    const nominalBay = Math.max(web * 2, (outerLimit - slotHalf) / Math.max(1, p.ribBays))
    for (const [from, to] of spans) {
      const bays = Math.max(1, Math.round((to - from) / nominalBay))
      for (let b = 0; b < bays; b++) {
        const a0 = from + ((to - from) * b) / bays + (b > 0 ? web / 2 : 0)
        const a1 = from + ((to - from) * (b + 1)) / bays - (b < bays - 1 ? web / 2 : 0)
        const hole = pocketHole(a0, a1, loAt, hiAt, web, 22, Math.max(3, p.plyThickness), p.pocketFill, p.pocketRound)
        if (!hole) continue
        holes.push(hole, hole.map((q) => v2(-q.x, q.y)))
      }
    }
  }

  return {
    id: `rib-${String(index + 1).padStart(2, '0')}`,
    kind: 'rib',
    label: `R${index + 1}`,
    poly: poly(outer, holes),
    thickness: p.plyThickness,
    qty: 1,
    station: x,
    engrave,
    marks,
    labelMark: {
      at: v2(-slotHalf - markSize * 0.5, ctx.slotFromTop ? slotMidZ(h, x) - markSize * 0.8 : slotMidZ(h, x) + markSize * 0.8),
      text: '',
      size: markSize,
      align: 'right',
    },
    meta: {
      station_mm: round1(x),
      station_pct: round1(u * 100),
      width_mm: round1(sec.halfWidth * 2 - p.skinThickness * 2),
      depth_mm: round1(frameTopZ(h, x) - frameBottomZ(h, x)),
      slots: live.length,
      feet: engrave.length,
      pockets: holes.length,
      of: total,
    },
  }
}

// ---------------------------------------------------------------- splices

/** One band boundary of a finger splice. Even bands sit forward of centre. */
const bandX = (xc: number, i: number, d: number) => (i % 2 === 0 ? xc + d : xc - d)

/**
 * A castellated end edge for a splice, generated bottom to top.
 * `tabParity` 0 means this piece owns the even bands: it is the tail piece.
 */
function fingerEdge(
  xc: number,
  tabParity: 0 | 1,
  d: number,
  teeth: number,
  clearance: number,
  zBotAt: (x: number) => number,
  zTopAt: (x: number) => number,
): V2[] {
  const zb = zBotAt(xc)
  const zt = zTopAt(xc)
  const step = (zt - zb) / teeth
  const shift = (boundary: number) => ((boundary % 2 === tabParity ? -1 : 1) * clearance) / 2
  const pts: V2[] = []
  for (let i = 0; i < teeth; i++) {
    const x = bandX(xc, i, d)
    const zLo = i === 0 ? zBotAt(x) : zb + i * step + shift(i - 1)
    const zHi = i === teeth - 1 ? zTopAt(x) : zb + (i + 1) * step + shift(i)
    pts.push(v2(x, zLo), v2(x, zHi))
  }
  return pts
}

// ---------------------------------------------------------------- panels

interface PanelSpec {
  id: string
  label: string
  kind: PartKind
  qty: number
  offsetY: number
  bottomAt: (x: number) => number
  topAt: (x: number) => number
  /** Rib stations this panel is slotted for, empty for the jig. */
  stations: number[]
  /** jointNumber(station) -> the number etched beside that slot. */
  jointNumber?: (station: number) => number
  slotEdge: 'top' | 'bottom' | 'none'
  slotMidAt: (x: number) => number
  lighten: boolean
  /** Cutouts per bay along the panel. */
  bays: number
  webScale: number
  extraMeta?: Record<string, number | string>
}

/**
 * One section of a vertical panel that runs along the board: the centre
 * stringer, a side stringer, or a cradle. Slots for the ribs are cut into
 * whichever edge the frame orientation calls for.
 */
function buildPanelPiece(
  h: Hull,
  spec: PanelSpec,
  index: number,
  total: number,
  xa: number,
  xb: number,
  leftJoint: number | null,
  rightJoint: number | null,
): Part {
  const p = h.p
  const d = p.fingerJointDepth
  const teeth = p.fingerJointTeeth
  const slotHalf = (p.plyThickness + p.slotClearance) / 2
  const bz = spec.bottomAt
  const tz = spec.topAt

  const startX = leftJoint === null ? xa : bandX(leftJoint, 0, d)
  const endX = rightJoint === null ? xb : bandX(rightJoint, 0, d)
  const topStartX = rightJoint === null ? xb : bandX(rightJoint, teeth - 1, d)
  const topEndX = leftJoint === null ? xa : bandX(leftJoint, teeth - 1, d)

  const mine = spec.stations
    .filter((s) => s > Math.min(startX, topEndX) + slotHalf && s < Math.max(endX, topStartX) - slotHalf)

  /** Walk one long edge, dropping a slot at each station if this edge carries them. */
  const runEdge = (from: number, to: number, zAt: (x: number) => number, notch: boolean): V2[] => {
    const pts: V2[] = []
    const dir = Math.sign(to - from) || 1
    const stops = mine.slice().sort((a, b) => (to - from) * (a - b))
    const steps = Math.max(24, Math.round(Math.abs(to - from) / 8))
    let si = 0
    for (let i = 0; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps
      if (notch) {
        while (si < stops.length && dir * (x - (stops[si] - dir * slotHalf)) >= 0) {
          const s = stops[si]
          const mid = spec.slotMidAt(s)
          const near = s - dir * slotHalf
          const far = s + dir * slotHalf
          pts.push(v2(near, zAt(near)), v2(near, mid), v2(far, mid), v2(far, zAt(far)))
          si++
        }
        if (stops.some((s) => Math.abs(x - s) < slotHalf)) continue
      }
      pts.push(v2(x, zAt(x)))
    }
    return pts
  }

  const pts: V2[] = []
  pts.push(...runEdge(startX, endX, bz, spec.slotEdge === 'bottom'))
  if (rightJoint !== null) pts.push(...fingerEdge(rightJoint, 0, d, teeth, p.slotClearance, bz, tz))
  else pts.push(v2(xb, tz(xb)))
  pts.push(...runEdge(topStartX, topEndX, tz, spec.slotEdge === 'top'))
  if (leftJoint !== null) pts.push(...fingerEdge(leftJoint, 1, d, teeth, p.slotClearance, bz, tz).reverse())

  // ---- lightening holes, one per bay between slots ----
  const holes: V2[][] = []
  if (spec.lighten) {
    const web = p.webWidth * spec.webScale
    let edges: number[]
    if (spec.stations.length) {
      edges = [startX, ...spec.stations.filter((s) => s > startX && s < endX).sort((a, b) => a - b), endX]
    } else {
      // no slots to divide it, so pick a bay count that keeps the holes sane
      const bays = 1 + Math.floor((endX - startX) / 380)
      edges = Array.from({ length: bays + 1 }, (_, i) => startX + ((endX - startX) * i) / bays)
    }
    for (let i = 0; i < edges.length - 1; i++) {
      const a0 = edges[i] + (i > 0 ? slotHalf : 0) + web
      const a1 = edges[i + 1] - (i < edges.length - 2 ? slotHalf : 0) - web
      const nearJoint = [leftJoint, rightJoint].some(
        (j) => j !== null && a0 < j + d + web && a1 > j - d - web,
      )
      if (nearJoint) continue
      const per = Math.max(1, spec.bays)
      for (let k = 0; k < per; k++) {
        const c0 = a0 + ((a1 - a0) * k) / per + (k > 0 ? web / 2 : 0)
        const c1 = a0 + ((a1 - a0) * (k + 1)) / per - (k < per - 1 ? web / 2 : 0)
        const hole = pocketHole(c0, c1, bz, tz, web, 24, Math.max(3, p.plyThickness), p.pocketFill, p.pocketRound)
        if (hole) holes.push(hole)
      }
    }
  }

  // etch the joint number beside every slot, matching the number on the rib
  const markSize = clamp(Math.min(p.webWidth * 0.55, (tz(startX) - bz(startX)) * 0.3), 2.5, 11)
  const marks: Mark[] = []
  if (spec.jointNumber && spec.slotEdge !== 'none') {
    for (const s2 of mine) {
      const mid = spec.slotMidAt(s2)
      marks.push({
        at: v2(s2 + slotHalf + markSize * 0.4, spec.slotEdge === 'top' ? mid - markSize * 0.8 : mid + markSize * 0.8),
        text: String(spec.jointNumber(s2)),
        size: markSize,
        align: 'left',
      })
    }
  }

  const suffix = total === 1 ? '' : `-${index + 1}`
  return {
    id: `${spec.id}${suffix}`,
    kind: spec.kind,
    label: total === 1 ? spec.label : `${spec.label}.${index + 1}`,
    poly: poly(pts, holes),
    thickness: p.plyThickness,
    qty: spec.qty,
    offsetY: spec.offsetY,
    marks,
    labelMark: (() => {
      // sit it in the solid band along the edge that carries no slots, so it
      // never lands in a lightening hole
      const cx = (startX + endX) / 2
      const band = p.webWidth * spec.webScale
      const size = Math.max(2.5, Math.min(10, band * 0.5))
      const zz = spec.slotEdge === 'top' ? bz(cx) + band * 0.55 : tz(cx) - band * 0.55
      return { at: v2(cx, zz), text: '', size, align: 'center' as const }
    })(),
    meta: {
      from_mm: round1(startX),
      to_mm: round1(endX),
      length_mm: round1(endX - startX),
      offset_y_mm: round1(spec.offsetY),
      slots: mine.length,
      ...spec.extraMeta,
    },
  }
}

/** Split a panel to fit the stock and build every piece. */
function buildPanel(h: Hull, spec: PanelSpec, x0: number, x1: number, splitAt: number[]): Part[] {
  const bounds = [x0, ...splitAt, x1]
  const out: Part[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    out.push(
      buildPanelPiece(
        h, spec, i, bounds.length - 1, bounds[i], bounds[i + 1],
        i === 0 ? null : splitAt[i - 1],
        i === bounds.length - 2 ? null : splitAt[i],
      ),
    )
  }
  return out
}

/**
 * Choose splice positions for a panel: as near an even division as possible,
 * always midway between two ribs so no slot lands on a joint, and enough of
 * them that every piece fits the sheet once the tabs are counted.
 */
function planSplits(h: Hull, x0: number, x1: number, stations: number[]): number[] {
  const p = h.p
  const usable = Math.max(40, p.sheetLength - 2 * p.partSpacing - 4)
  const mids = stations.slice(0, -1).map((s, i) => (s + stations[i + 1]) / 2).filter((m) => m > x0 && m < x1)

  const choose = (pieces: number): number[] => {
    const out: number[] = []
    for (let i = 1; i < pieces; i++) {
      const ideal = x0 + ((x1 - x0) * i) / pieces
      let best = ideal
      let dist = Infinity
      for (const m of mids) {
        if (Math.abs(m - ideal) < dist && !out.includes(m)) { dist = Math.abs(m - ideal); best = m }
      }
      if (dist < Infinity) out.push(best)
    }
    return out.sort((a, b) => a - b)
  }
  const longest = (splits: number[]) => {
    const edges = [x0, ...splits, x1]
    let worst = 0
    for (let i = 0; i < edges.length - 1; i++) {
      const joints = (i > 0 ? 1 : 0) + (i < edges.length - 2 ? 1 : 0)
      worst = Math.max(worst, edges[i + 1] - edges[i] + joints * p.fingerJointDepth)
    }
    return worst
  }

  let pieces = Math.max(1, Math.ceil((x1 - x0) / usable))
  let splits = choose(pieces)
  while (pieces < mids.length + 1 && longest(splits) > usable) {
    pieces++
    const next = choose(pieces)
    if (next.length === splits.length) break
    splits = next
  }
  return splits
}

/** Where a panel at offset `y` is still deep enough to be worth building. */
function panelLimits(h: Hull, y: number): [number, number] | null {
  const p = h.p
  const minDepth = Math.max(p.plyThickness * 2.5, p.thickness * 0.06)
  const deep = (u: number) => {
    const x = h.xOf(u)
    const sec = h.section(u)
    if (Math.abs(y) > sec.halfWidth - p.skinThickness - p.plyThickness) return -1
    return panelTopZ(h, x, y) - panelBottomZ(h, x, y) - minDepth
  }
  const peak = h.p.widePoint
  if (deep(peak) <= 0) return null
  const solve = (from: number) => {
    let a = from
    let b = peak
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      if (deep(m) > 0) b = m
      else a = m
    }
    return (a + b) / 2
  }
  return [deep(0) > 0 ? 0 : h.xOf(solve(0)), deep(1) > 0 ? h.p.length : h.xOf(solve(1))]
}

// ---------------------------------------------------------------- cradle

export function buildJig(h: Hull, x0: number, x1: number, splits: number[], stations: number[], refY = 0): Part[] {
  const p = h.p
  const under = (x: number) => panelBottomZ(h, x, refY)
  let lowest = Infinity
  for (let i = 0; i <= 200; i++) lowest = Math.min(lowest, under(x0 + ((x1 - x0) * i) / 200))
  const baseZ = lowest - p.jigClearance - p.jigDepth
  const parts = buildPanel(h, {
    id: 'jig',
    label: 'JIG',
    kind: 'jig',
    qty: 2,
    offsetY: 0,
    bottomAt: () => baseZ,
    topAt: (x) => under(x) - p.jigClearance,
    stations: [],
    slotEdge: 'none',
    slotMidAt: () => 0,
    lighten: true,
    bays: 1,
    webScale: 1.6,
    extraMeta: { base_z_mm: round1(baseZ), clearance_mm: p.jigClearance, note: 'setup jig, not part of the board' },
  }, x0, x1, splits)
  for (const part of parts) {
    fitMarks(part)
    const from = Number(part.meta.from_mm)
    const to = Number(part.meta.to_mm)
    part.engrave = stations
      .filter((s) => s > from + 2 && s < to - 2)
      .map((s) => {
        const t = under(s) - p.jigClearance
        return [v2(s, t), v2(s, t - Math.min(30, (t - baseZ) * 0.35))]
      })
  }
  return parts
}

// ---------------------------------------------------------------- frame

export function buildFrame(h: Hull): Frame {
  const p = h.p
  const offsets = spineOffsets(p)
  const innerY = offsets[0]
  const centre = panelLimits(h, innerY) ?? [0, p.length]
  const [x0, x1] = centre

  // Ribs have to land where a spine actually exists, otherwise a rib gets a
  // slot with nothing to slot onto. Pull the requested range in if it overruns.
  const margin = Math.max(p.plyThickness * 2, p.length * 0.004)
  const lo = Math.max(h.xOf(p.ribInsetTail), x0 + margin)
  const hi = Math.min(h.xOf(p.ribInsetNose), x1 - margin)
  const clamped = lo > h.xOf(p.ribInsetTail) + 0.5 || hi < h.xOf(p.ribInsetNose) - 0.5

  const stations: number[] = []
  for (let i = 0; i < p.ribCount; i++) stations.push(lo + ((hi - lo) * i) / (p.ribCount - 1))

  // Close the ends with more of the same. Past where the rail plank stops
  // there is nothing holding the planking but the spines, so the tips get
  // ribs at a closer spacing, out to the tip itself. All flat parts, each cut
  // to its own station: nothing here wants carving.
  const endRibCount = { tail: 0, nose: 0 }
  if (p.endRibs) {
    const reach = plankLimits(h)
    const tailTo = reach ? Math.min(reach[0], lo) : lo
    const noseFrom = reach ? Math.max(reach[1], hi) : hi
    // exactly the test `slotted` will apply below, so a rib is never placed
    // somewhere it cannot then be slotted
    const buildable = (x: number) =>
      x > x0 + margin && x < x1 - margin && jointLive(h, x, innerY)
    for (let x = lo - p.endRibSpacing; x > 0; x -= p.endRibSpacing) {
      if (x > tailTo + p.endRibSpacing) continue
      if (buildable(x)) { stations.push(x); endRibCount.tail++ }
    }
    for (let x = hi + p.endRibSpacing; x < p.length; x += p.endRibSpacing) {
      if (x < noseFrom - p.endRibSpacing) continue
      if (buildable(x)) { stations.push(x); endRibCount.nose++ }
    }
    // The tip faces themselves. These are the pieces that actually close the
    // board front and back, so they go in even when the last step is short.
    // The outermost ribs sit a shoulder in from the tips, not on them: a spine
    // needs material past a slot to hold it, so a rib right on the tip face
    // could not be slotted onto anything and would simply float.
    for (const [tip, which] of [[x0 + margin * 1.25, 'tail'], [x1 - margin * 1.25, 'nose']] as const) {
      if (!buildable(tip)) continue
      if (stations.some((s2) => Math.abs(s2 - tip) < p.endRibSpacing * 0.4)) continue
      stations.push(tip)
      endRibCount[which]++
    }
    stations.sort((a, b) => a - b)
  }

  const signed = offsets.flatMap((y) => (y === 0 ? [0] : [y, -y]))

  // Work out where every spine reaches before any rib is cut, so the two
  // halves of each half lap are decided in exactly one place.
  const panelRange = new Map<number, [number, number]>()
  const slotted = new Map<number, Set<number>>()
  for (let k = 0; k < offsets.length; k++) {
    const y = offsets[k]
    const limits = k === 0 ? centre : panelLimits(h, y)
    if (!limits) continue
    panelRange.set(y, limits)
    const live = new Set<number>()
    stations.forEach((st, i) => {
      if (st > limits[0] + margin && st < limits[1] - margin && jointLive(h, st, y)) live.add(i)
    })
    slotted.set(y, live)
  }

  const slotFromTop = p.ribFeet
  const footBaseZ = p.ribFeet
    ? Math.min(...stations.map((x) => frameBottomZ(h, x))) - p.footHeight
    : null

  // Number every half lap so assembly is a matter of matching numbers. Each
  // spine takes a block of numbers, innermost first.
  const jointBase = new Map<number, number>()
  offsets.forEach((y, k) => jointBase.set(y, k * stations.length))
  const jointNumber = p.numberJoints
    ? (ribIndex: number, absY: number) => (jointBase.get(absY) ?? 0) + ribIndex + 1
    : null

  const ribs = stations.map((x, i) =>
    buildRib(h, x, i, stations.length, { stations, offsets: signed, slotFromTop, footBaseZ, jointNumber, slotted }),
  )

  // Every spine is a planar panel at a fixed offset, so it cuts flat and
  // stands vertical. Anything off the centreline is used twice, once per side.
  const splits = planSplits(h, x0, x1, stations)
  const longitudinals: Longitudinal[] = []
  const stringers: Part[] = []

  for (let k = 0; k < offsets.length; k++) {
    const y = offsets[k]
    const limits = panelRange.get(y)
    if (!limits) continue
    const mine = stations.filter((_, i) => slotted.get(y)?.has(i))
    if (mine.length < 2) continue
    // A panel stops a shoulder past its outermost joint. Running on to wherever
    // the section happens to get too shallow leaves a long cantilever hanging
    // off the end, held by nothing.
    const shoulder = margin
    const sx0 = Math.max(limits[0], mine[0] - shoulder)
    const sx1 = Math.min(limits[1], mine[mine.length - 1] + shoulder)
    const sSplits = planSplits(h, sx0, sx1, mine)
    longitudinals.push({ y, x0: sx0, x1: sx1, splits: sSplits })
    stringers.push(...buildPanel(h, {
      id: y === 0 ? 'stringer' : `spine-${k + 1}`,
      label: y === 0 ? 'STRINGER' : `SP${k + 1}`,
      kind: 'stringer',
      qty: y === 0 ? 1 : 2,
      offsetY: y,
      bottomAt: (x) => panelBottomZ(h, x, y),
      topAt: (x) => panelTopZ(h, x, y),
      stations: mine,
      slotEdge: slotFromTop ? 'bottom' : 'top',
      slotMidAt: (x) => panelMidZ(h, x, y),
      jointNumber: jointNumber ? (s2) => jointNumber(stations.indexOf(s2), y) : undefined,
      lighten: p.lightenStringer,
      bays: p.spineBays,
      webScale: 1,
    }, sx0, sx1, sSplits))
  }

  for (const part of [...ribs, ...stringers]) fitMarks(part)

  return {
    hull: h,
    ribs,
    stringers,
    jigs: p.rockerJig ? buildJig(h, x0, x1, splits, stations, innerY) : [],
    stations,
    longitudinals,
    slotWidth: p.plyThickness + p.slotClearance,
    x0,
    x1,
    splits,
    ribsClampedToStringer: clamped,
    endRibCount,
    mainSpacing: p.ribCount > 1 ? (hi - lo) / (p.ribCount - 1) : hi - lo,
    slotted,
    ribSlotFromTop: slotFromTop,
    footBaseZ,
  }
}

/**
 * Keep every etched mark inside the part it belongs to.
 *
 * The nester interlocks parts tightly, so text that runs past its own outline
 * does not simply look untidy: it is scribed onto whatever is sitting next to
 * it on the sheet. A mark that does not fit is shrunk, and one that will not
 * fit even at a legible size is dropped rather than cut somewhere wrong.
 */
export function fitMarks(part: Part, minSize = 2.5): void {
  const holes = part.poly.holes
  const solid = (pt: V2) => pointInPolygon(pt, part.poly.outer) && !holes.some((h) => pointInPolygon(pt, h))

  // Test the strokes that will actually be cut, not a grid over their bounding
  // box: a curved strip can pass through every sample of a coarse grid and
  // still have the glyphs hanging off its edge in between.
  const fitsAt = (m: Mark, text: string, size: number) => {
    for (const line of strokeText(text, m.at.x, m.at.y, size, m.align ?? 'center', m.vAlign ?? 'middle')) {
      for (const q of line) if (!solid(q)) return false
    }
    return true
  }

  const fit = (m: Mark, text: string): Mark | null => {
    let size = m.size
    while (size >= minSize) {
      if (fitsAt(m, text, size)) return { ...m, size }
      size *= 0.8
    }
    return null
  }

  if (part.marks?.length) {
    part.marks = part.marks.map((m) => fit(m, m.text)).filter((m): m is Mark => m !== null)
  }
  if (part.labelMark) {
    // copies pick up a one letter suffix downstream, so allow for it
    const text = part.qty > 1 ? `${part.label}a` : part.label
    part.labelMark = fit(part.labelMark, text) ?? undefined
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10
