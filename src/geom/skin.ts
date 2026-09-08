import { Hull } from './hull'
import { plankLimits, railSeat, type Part } from './frame'
import { V2, V3, v2, poly, dist3, arcParam, atArc, sub2, norm2, dot2, add2, mul2, len2, signedArea } from './vec'

/**
 * Develops the planking into flat panels.
 *
 * The skin is treated as a set of longitudinal strips running keel to deck
 * centre. Each strip is triangulated between its two edge curves and then
 * unrolled triangle by triangle, which is exact for a developable strip and
 * within a fraction of a millimetre for the mild double curvature a board
 * actually has. Narrower strips mean less distortion, so `skinStrips` is the
 * knob to turn if a panel refuses to lie down on the frame.
 *
 * When an outer rail plank is fitted, the flat rail band belongs to that plank
 * rather than to the skin, so the strip boundaries are pulled onto the band
 * edges and the skin stops there on both sides.
 */

interface CircleHit { a: V2; b: V2 }

function circleIntersect(p: V2, r1: number, q: V2, r2: number): CircleHit | null {
  const d = len2(sub2(q, p))
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h2 = r1 * r1 - a * a
  if (h2 < 0) return null
  const h = Math.sqrt(h2)
  const dir = mul2(sub2(q, p), 1 / d)
  const mid = add2(p, mul2(dir, a))
  const perp = v2(-dir.y, dir.x)
  return { a: add2(mid, mul2(perp, h)), b: add2(mid, mul2(perp, -h)) }
}

function pickForward(hit: CircleHit | null, from: V2, fwd: V2, fallbackR: number): V2 {
  if (!hit) return add2(from, mul2(fwd, fallbackR))
  return dot2(sub2(hit.a, from), fwd) >= dot2(sub2(hit.b, from), fwd) ? hit.a : hit.b
}

/**
 * Unroll a ribbon between two 3D edge curves, triangle by triangle. Exact for
 * a developable band and close enough for the mild double curvature here.
 */
function unrollBand(A: V3[], B: V3[]): { flatA: V2[]; flatB: V2[] } {
  const flatA: V2[] = [v2(0, 0)]
  const flatB: V2[] = [v2(0, dist3(A[0], B[0]))]
  let fwd = v2(1, 0)
  for (let i = 0; i < A.length - 1; i++) {
    const nextA = pickForward(
      circleIntersect(flatA[i], dist3(A[i], A[i + 1]), flatB[i], dist3(B[i], A[i + 1])),
      flatA[i], fwd, dist3(A[i], A[i + 1]),
    )
    flatA.push(nextA)
    const step = sub2(nextA, flatA[i])
    if (len2(step) > 1e-6) fwd = norm2(step)
    flatB.push(pickForward(
      circleIntersect(nextA, dist3(A[i + 1], B[i + 1]), flatB[i], dist3(B[i], B[i + 1])),
      flatB[i], fwd, dist3(B[i], B[i + 1]),
    ))
  }
  return { flatA, flatB }
}

interface Row { u: number; x: number; pts: V2[]; par: number[]; sLow: number; sHigh: number }

/** Station grid on the mid surface of a covering, optionally over part of the length. */
function makeRows(h: Hull, thickness: number, nStations: number, quarter = 60, u0 = 0, u1 = 1): Row[] {
  const inset = thickness / 2 // develop the mid surface: that is the true length
  const rows: Row[] = []
  // the band sits at a known place in the sample order, so its arc positions
  // can be read straight off rather than searched for
  const bandStart = quarter
  const bandEnd = quarter + Math.max(2, Math.round(quarter / 3))
  for (let i = 0; i < nStations; i++) {
    const u = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos((i / (nStations - 1)) * Math.PI))
    const half = h.halfSection(u, quarter)
    const sec = h.section(u)
    const cz = (sec.bottomZ + sec.topZ) / 2
    const pulled = half.map((q) => {
      const dir = norm2(v2(q.x, q.y - cz))
      return v2(q.x - dir.x * inset, q.y - dir.y * inset)
    })
    const par = arcParam(pulled)
    rows.push({ u, x: h.xOf(u), pts: pulled, par, sLow: par[bandStart], sHigh: par[bandEnd] })
  }
  return rows
}

const at3 = (r: Row, s: number): V3 => {
  const q = atArc(r.pts, r.par, s)
  return { x: r.x, y: q.x, z: q.y }
}

export interface StripDev {
  index: number
  kind: 'skin' | 'plank'
  /** The run of the board this covers, in board coordinates, not arc length. */
  spanX: [number, number]
  flatA: V2[] // keel side edge, flattened
  flatB: V2[] // deck side edge, flattened
  stationsAlong: { x: number; a: V2; b: V2 }[] // where each rib crosses it
  meta: {
    edge_length_mm: number
    max_width_mm: number
    min_width_mm: number
    bevel_inner_deg: number
    bevel_outer_deg: number
  }
}

/**
 * Dihedral turn of the station outline at normalized arc position s, in
 * degrees. Read off the row that has already been built rather than deriving a
 * fresh section from the hull: this runs for every row of every strip, and
 * rebuilding the section each time dominated the whole develop step.
 */
function bevelOn(row: Row, s: number): number {
  const { pts: half, par } = row
  const e = 0.02
  const p0 = atArc(half, par, Math.max(0, s - e))
  const p1 = atArc(half, par, s)
  const p2 = atArc(half, par, Math.min(1, s + e))
  const t1 = norm2(sub2(p1, p0))
  const t2 = norm2(sub2(p2, p1))
  const cross = t1.x * t2.y - t1.y * t2.x
  return (Math.atan2(cross, dot2(t1, t2)) * 180) / Math.PI
}

/** Build one developed band from a per row pair of arc positions. */
function buildDev(
  h: Hull, rows: Row[], stations: number[], index: number, kind: 'skin' | 'plank',
  sA: (r: Row) => number, sB: (r: Row) => number,
): StripDev {
  const A = rows.map((r) => at3(r, sA(r)))
  const B = rows.map((r) => at3(r, sB(r)))
  const { flatA, flatB } = unrollBand(A, B)

  const stationsAlong = stations.map((sx) => {
    const u = h.uOf(sx)
    let i = 1
    while (i < rows.length - 1 && rows[i].u < u) i++
    const t = (u - rows[i - 1].u) / Math.max(1e-9, rows[i].u - rows[i - 1].u)
    const lerpV = (m: V2, n: V2) => v2(m.x + (n.x - m.x) * t, m.y + (n.y - m.y) * t)
    return { x: sx, a: lerpV(flatA[i - 1], flatA[i]), b: lerpV(flatB[i - 1], flatB[i]) }
  })

  let minW = Infinity
  let maxW = 0
  for (let i = 0; i < A.length; i++) {
    const w = dist3(A[i], B[i])
    minW = Math.min(minW, w)
    maxW = Math.max(maxW, w)
  }
  const bevIn: number[] = []
  const bevOut: number[] = []
  for (let i = 0; i < rows.length; i += 4) {
    const r = rows[i]
    if (r.u < 0.08 || r.u > 0.92) continue
    bevIn.push(Math.abs(bevelOn(r, sA(r))))
    bevOut.push(Math.abs(bevelOn(r, sB(r))))
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

  return {
    index, kind, spanX: [rows[0].x, rows[rows.length - 1].x], flatA, flatB, stationsAlong,
    meta: {
      edge_length_mm: r1(pathLen(flatA)),
      max_width_mm: r1(maxW),
      min_width_mm: r1(minW),
      bevel_inner_deg: r1(avg(bevIn)),
      bevel_outer_deg: r1(avg(bevOut)),
    },
  }
}

export function developStrips(h: Hull, stations: number[], nStations = 141): StripDev[] {
  const p = h.p
  const rows = makeRows(h, p.skinThickness, nStations)
  const out: StripDev[] = []

  if (!p.outerPlank) {
    for (let j = 0; j < p.skinStrips; j++) {
      out.push(buildDev(h, rows, stations, j, 'skin', () => j / p.skinStrips, () => (j + 1) / p.skinStrips))
    }
    return out
  }

  // Split the remaining skin either side of the rail band, in proportion to
  // how much of the section each part covers, so the strips stay even.
  const mid = rows[Math.floor(rows.length / 2)]
  const hullShare = mid.sLow
  const deckShare = 1 - mid.sHigh
  const total = hullShare + deckShare
  let nHull = Math.max(1, Math.round((p.skinStrips * hullShare) / Math.max(1e-6, total)))
  let nDeck = Math.max(1, p.skinStrips - nHull)
  if (nHull + nDeck !== p.skinStrips) nHull = Math.max(1, p.skinStrips - nDeck)

  for (let j = 0; j < nHull; j++) {
    out.push(buildDev(h, rows, stations, out.length, 'skin',
      (r) => (r.sLow * j) / nHull, (r) => (r.sLow * (j + 1)) / nHull))
  }
  for (let j = 0; j < nDeck; j++) {
    out.push(buildDev(h, rows, stations, out.length, 'skin',
      (r) => r.sHigh + ((1 - r.sHigh) * j) / nDeck,
      (r) => r.sHigh + ((1 - r.sHigh) * (j + 1)) / nDeck))
  }
  return out
}

/**
 * The outer rail plank: the flat rail band, developed on its own mid surface,
 * with a mortise at every rib station for that rib's tenon.
 */
export function developPlank(h: Hull, stations: number[], nStations = 141): StripDev | null {
  const p = h.p
  if (!p.outerPlank) return null
  // The band closes to nothing at both tips, so the plank stops while it still
  // has a section rather than running out to a knife edge. It then stops again
  // a shoulder past its outermost mortise: running on to the limit of the band
  // would leave a long tongue hanging off each end, held by nothing.
  const limits = plankLimits(h)
  if (!limits) return null
  const mine = stations.filter((s) => s > limits[0] && s < limits[1])
  if (mine.length < 2) return null
  const shoulder = Math.max(p.plyThickness * 2, p.length * 0.004)
  const x0 = Math.max(limits[0], mine[0] - shoulder)
  const x1 = Math.min(limits[1], mine[mine.length - 1] + shoulder)
  const rows = makeRows(h, p.outerPlankThickness, nStations, 60, h.uOf(x0), h.uOf(x1))
  let widest = 0
  for (const r of rows) widest = Math.max(widest, dist3(at3(r, r.sLow), at3(r, r.sHigh)))
  if (widest < 2) return null
  return buildDev(h, rows, mine, 0, 'plank', (r) => r.sLow, (r) => r.sHigh)
}

function pathLen(pts: V2[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return l
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** A rectangle across the plank at a station, sized for one rib tenon. */
function mortise(a: V2, b: V2, width: number, height: number): V2[] | null {
  const span = sub2(b, a)
  const l = len2(span)
  if (l < height + 2) return null
  const up = mul2(span, 1 / l)
  const along = v2(up.y, -up.x)
  const c = v2((a.x + b.x) / 2, (a.y + b.y) / 2)
  const hw = width / 2
  const hh = Math.min(height, l - 2) / 2
  return [
    add2(add2(c, mul2(along, -hw)), mul2(up, -hh)),
    add2(add2(c, mul2(along, hw)), mul2(up, -hh)),
    add2(add2(c, mul2(along, hw)), mul2(up, hh)),
    add2(add2(c, mul2(along, -hw)), mul2(up, hh)),
  ]
}

/**
 * Cut a developed band into sections that fit the stock, adding a scarf
 * allowance of 8x thickness at every split so the joint can be planed to a
 * feather. Station marks are engraved, mortises are cut.
 */
function sectionsOf(
  h: Hull, d: StripDev, thickness: number, idBase: string, labelBase: string,
  qty: number, kind: Part['kind'],
  /** Mortise width, and its height at a station: the tenon tapers, so this does. */
  mortiseSpec: { width: number; heightAt: (x: number) => number } | null,
): Part[] {
  const p = h.p
  const parts: Part[] = []
  const scarf = thickness * 8
  const usable = Math.max(200, p.sheetLength - 2 * p.partSpacing - 4)
  const total = pathLen(d.flatA)
  const sections = Math.max(1, Math.ceil(total / Math.max(1, usable - 2 * scarf)))
  const parA = arcParam(d.flatA)
  const parB = arcParam(d.flatB)

  for (let k = 0; k < sections; k++) {
    const pad = scarf / Math.max(1, total)
    const t0 = Math.max(0, k / sections - (k > 0 ? pad : 0))
    const t1 = Math.min(1, (k + 1) / sections + (k < sections - 1 ? pad : 0))

    const a: V2[] = []
    const b: V2[] = []
    for (let i = 0; i < d.flatA.length; i++) {
      if (parA[i] >= t0 && parA[i] <= t1) a.push(d.flatA[i])
      if (parB[i] >= t0 && parB[i] <= t1) b.push(d.flatB[i])
    }
    if (a.length < 2 || b.length < 2) continue
    a.unshift(atArc(d.flatA, parA, t0))
    a.push(atArc(d.flatA, parA, t1))
    b.unshift(atArc(d.flatB, parB, t0))
    b.push(atArc(d.flatB, parB, t1))

    const outline = a.concat(b.slice().reverse())
    if (Math.abs(signedArea(outline)) < 25) continue // under a quarter of a square centimetre
    const lo = a[0].x - 1
    const hi = a[a.length - 1].x + 1
    const mine = d.stationsAlong.filter((s) => s.a.x >= lo && s.a.x <= hi)

    const holes: V2[][] = []
    const engrave: V2[][] = []
    for (const s of mine) {
      if (mortiseSpec) {
        const height = mortiseSpec.heightAt(s.x)
        const m = height > 1 ? mortise(s.a, s.b, mortiseSpec.width, height) : null
        if (m) { holes.push(m); continue }
      }
      engrave.push([s.a, s.b])
    }

    // A curved strip's bounding box centre can fall clean off the strip, so
    // anchor the etched name between the two edges instead.
    const parAA = arcParam(a)
    const parBB = arcParam(b)
    const ca = atArc(a, parAA, 0.5)
    const cb = atArc(b, parBB, 0.5)
    const bandW = Math.hypot(cb.x - ca.x, cb.y - ca.y)

    const suffix = sections === 1 ? '' : `-${k + 1}`
    parts.push({
      id: `${idBase}${suffix}`,
      kind,
      label: sections === 1 ? labelBase : `${labelBase}.${k + 1}`,
      poly: poly(outline, holes),
      thickness,
      qty,
      labelMark: {
        at: v2((ca.x + cb.x) / 2, (ca.y + cb.y) / 2),
        text: '',
        size: Math.max(2.5, Math.min(12, bandW * 0.42, pathLen(a) * 0.04)),
        align: 'center',
      },
      meta: {
        section: k + 1,
        of_sections: sections,
        length_mm: r1(pathLen(a)),
        max_width_mm: d.meta.max_width_mm,
        bevel_keel_side_deg: d.meta.bevel_inner_deg,
        bevel_deck_side_deg: d.meta.bevel_outer_deg,
        scarf_mm: sections > 1 ? r1(scarf) : 0,
        mortises: holes.length,
      },
      engrave,
    })
  }
  return parts
}

export function stripParts(h: Hull, devs: StripDev[]): Part[] {
  return devs.flatMap((d) =>
    sectionsOf(h, d, h.p.skinThickness, `skin-${d.index + 1}`, `S${d.index + 1}`, 2, 'skin', null),
  )
}

export function plankParts(h: Hull, dev: StripDev | null): Part[] {
  if (!dev) return []
  const p = h.p
  return sectionsOf(h, dev, p.outerPlankThickness, 'plank', 'RAIL', 2, 'skin', {
    width: p.plyThickness + p.slotClearance,
    // the rib's tenon shrinks with the band toward the tips, so the mortise
    // that receives it has to shrink by exactly the same rule
    heightAt: (x) => (railSeat(h, x)?.tenonHalf ?? 0) * 2,
  })
}
