import type { Mark, Part } from '../geom/frame'
import type { Params } from '../params'
import { Poly, V2, bboxW, bboxH, offsetPoly, polyBBox, rotatePoly, signedArea, translatePoly, v2 } from '../geom/vec'

export interface Placement {
  part: Part
  copy: number
  poly: Poly // sheet coordinates, kerf compensated
  engrave: V2[][]
  /** Text to etch, already moved onto the sheet and kept upright. */
  marks: Mark[]
  /** Where and how big the part name is etched, or null when it will not fit. */
  label: Mark | null
  rotationDeg: number
  w: number
  h: number
  x: number
  y: number
}

export interface Sheet {
  index: number
  material: string
  thickness: number
  width: number
  length: number
  placements: Placement[]
  areaUsed: number
}

export interface NestResult {
  sheets: Sheet[]
  rejected: { part: Part; reason: string }[]
  /** Fraction of sheet area actually covered by parts, across all sheets. */
  yield: number
}

/** How many of the most recent sheets a part may backfill into. */
const BACKFILL_SHEETS = 6

/** Runaway guard: stock this far off the part sizes is a mistake, not a plan. */
const MAX_SHEETS = 200

/** Per column floor and ceiling of a shape, used to slot parts into each other. */
interface Profile {
  cols: number
  min: Float64Array // +Infinity where the shape does not reach
  max: Float64Array // -Infinity where the shape does not reach
}

function profileOf(p: Poly, res: number, w: number): Profile {
  const cols = Math.max(1, Math.ceil(w / res) + 1)
  const min = new Float64Array(cols).fill(Infinity)
  const max = new Float64Array(cols).fill(-Infinity)
  const hit = (x: number, y: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / res)))
    if (y < min[c]) min[c] = y
    if (y > max[c]) max[c] = y
  }
  const loop = p.outer
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (res / 2)))
    for (let s = 0; s <= steps; s++) {
      hit(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)
    }
  }
  // bridge any column the sampling stepped over
  for (let c = 1; c < cols; c++) {
    if (min[c] === Infinity && min[c - 1] !== Infinity) { min[c] = min[c - 1]; max[c] = max[c - 1] }
  }
  for (let c = cols - 2; c >= 0; c--) {
    if (min[c] === Infinity && min[c + 1] !== Infinity) { min[c] = min[c + 1]; max[c] = max[c + 1] }
  }
  return { cols, min, max }
}

interface Candidate { poly: Poly; engrave: V2[][]; marks: Mark[]; label: Mark | null; w: number; h: number; rotationDeg: number; prof: Profile }

function orient(base: Poly, eng: V2[][], marks: Mark[], label: Mark | null, deg: number, res: number): Candidate {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const rp = deg === 0 ? base : rotatePoly(base, rad)
  const re = deg === 0 ? eng : eng.map((l) => l.map((q) => v2(q.x * c - q.y * s, q.x * s + q.y * c)))
  const bb = polyBBox(rp)
  const poly = translatePoly(rp, -bb.minX, -bb.minY)
  const move = (q: V2) => v2(q.x * c - q.y * s - bb.minX, q.x * s + q.y * c - bb.minY)
  const engrave = re.map((l) => l.map((q) => v2(q.x - bb.minX, q.y - bb.minY)))
  // the anchor turns with the part, the glyphs stay the right way up
  const outMarks = marks.map((m) => ({ ...m, at: move(m.at) }))
  const outLabel = label ? { ...label, at: move(label.at) } : null
  const w = bboxW(bb)
  const h = bboxH(bb)
  return { poly, engrave, marks: outMarks, label: outLabel, w, h, rotationDeg: deg, prof: profileOf(poly, res, w) }
}

/**
 * Skyline nesting with shape awareness.
 *
 * Each part carries a per column floor and ceiling, so a curved skin strip
 * drops into the hollow of the strip below it rather than sitting on its
 * bounding box. Every part is tried both ways round, and turned a quarter
 * turn as well when it is too tall to lie flat.
 */
export function nest(parts: Part[], p: Params, material: string): NestResult {
  const gap = p.partSpacing
  const usableL = p.sheetLength
  const usableW = p.sheetWidth
  // Column width for the skyline. Finer than about a millimetre buys nothing
  // a saw could act on and costs a lot: the placement scan is columns times
  // part columns, so halving this quadruples the work.
  const res = Math.min(6, Math.max(1.2, p.sheetLength / 320))
  const gapCols = Math.max(1, Math.ceil(gap / res))
  const sheetCols = Math.ceil(usableL / res) + 1

  const rejected: { part: Part; reason: string }[] = []
  const queue: { part: Part; copy: number; opts: Candidate[]; area: number }[] = []

  for (const part of parts) {
    // Grow the cut path by half the kerf: the beam then burns back to the
    // nominal line, which also brings every slot out at its true width.
    const kerfed = offsetPoly(part.poly, p.kerf / 2)
    const eng = part.engrave ?? []
    const marks = p.etchLabels ? (part.marks ?? []) : []
    const label = p.etchLabels ? (part.labelMark ?? null) : null
    const bb = polyBBox(kerfed)

    // Try it both ways round, and a quarter turn as well when it is too tall
    // to lie flat. Marks are re-anchored per orientation but stay upright.
    const degs = bboxH(bb) > usableW - gap * 2 ? [90, 270] : [0, 180]
    const opts = degs
      .map((d) => orient(kerfed, eng, marks, label, d, res))
      .filter((c) => c.w <= usableL - gap * 2 + 1e-6 && c.h <= usableW - gap * 2 + 1e-6)

    if (!opts.length) {
      rejected.push({
        part,
        reason: `needs ${Math.ceil(bboxW(bb))} x ${Math.ceil(bboxH(bb))} mm, the sheet gives ${Math.floor(usableL - gap * 2)} x ${Math.floor(usableW - gap * 2)} mm`,
      })
      continue
    }
    for (let c = 0; c < part.qty; c++) queue.push({ part, copy: c, opts, area: opts[0].w * opts[0].h })
  }

  // biggest first: large parts need the freedom, offcuts fill in behind them
  queue.sort((a, b) => b.opts[0].h - a.opts[0].h || b.area - a.area)

  const sheets: Sheet[] = []
  const skylines: Float64Array[] = []
  const newSheet = () => {
    sheets.push({
      index: sheets.length + 1,
      material,
      thickness: parts[0]?.thickness ?? p.plyThickness,
      width: usableW,
      length: usableL,
      placements: [],
      areaUsed: 0,
    })
    skylines.push(new Float64Array(sheetCols))
  }

  const firstCol = Math.ceil(gap / res)

  const tryPlace = (skyline: Float64Array, cand: Candidate): { x: number; y: number } | null => {
    const { prof } = cand
    // Cheap lower bound before the column scan: the part can never sit lower
    // than the lowest point of the skyline, so a sheet with no room left is
    // rejected in one pass instead of one pass per candidate position.
    let minSky = Infinity
    for (let i = 0; i < sheetCols; i++) if (skyline[i] < minSky) minSky = skyline[i]
    let minProf = Infinity
    for (let k = 0; k < prof.cols; k++) if (prof.min[k] < minProf) minProf = prof.min[k]
    if (minSky + gap - Math.min(minProf, 0) + cand.h > usableW - gap) return null

    let best: { x: number; y: number; score: number } | null = null
    for (let c = firstCol; c + prof.cols <= sheetCols; c++) {
      const x = c * res
      if (x + cand.w > usableL - gap) break
      let y = gap
      for (let k = 0; k < prof.cols; k++) {
        if (prof.min[k] === Infinity) continue
        const need = skyline[c + k] + gap - prof.min[k]
        if (need > y) y = need
      }
      if (y + cand.h > usableW - gap) continue
      const score = y * 1e6 + x // lowest first, then leftmost
      if (!best || score < best.score) best = { x, y, score }
      // nothing can beat sitting on the floor at the leftmost column, and on a
      // fresh sheet that is the very first position tried
      if (y <= gap + 1e-9) break
    }
    return best ? { x: best.x, y: best.y } : null
  }

  const commit = (skyline: Float64Array, cand: Candidate, x: number, y: number) => {
    const c0 = Math.round(x / res)
    for (let k = 0; k < cand.prof.cols; k++) {
      if (cand.prof.max[k] === -Infinity) continue
      const top = y + cand.prof.max[k]
      for (let d = -gapCols; d <= gapCols; d++) {
        const i = c0 + k + d
        if (i >= 0 && i < sheetCols && skyline[i] < top) skyline[i] = top
      }
    }
  }

  for (const item of queue) {
    if (!sheets.length) newSheet()
    // Look at the recently opened sheets before reaching for a fresh one, so
    // small parts backfill the gaps the big ones left behind. The window is
    // bounded: parts go on biggest first, so older sheets are already full,
    // and scanning all of them turns a run on tiny stock quadratic.
    let placed: { sheet: number; cand: Candidate; x: number; y: number; score: number } | null = null
    for (let si = Math.max(0, sheets.length - BACKFILL_SHEETS); si < sheets.length; si++) {
      for (const cand of item.opts) {
        const spot = tryPlace(skylines[si], cand)
        if (!spot) continue
        const score = si * 1e9 + spot.y * 1e3 + spot.x * 1e-3
        if (!placed || score < placed.score) placed = { sheet: si, cand, ...spot, score }
      }
    }
    if (!placed && sheets.length >= MAX_SHEETS) {
      rejected.push({
        part: item.part,
        reason: `would need more than ${MAX_SHEETS} sheets at ${Math.floor(usableL)} x ${Math.floor(usableW)} mm`,
      })
      continue
    }
    if (!placed) {
      newSheet()
      const si = sheets.length - 1
      for (const cand of item.opts) {
        const spot = tryPlace(skylines[si], cand)
        if (!spot) continue
        const score = spot.y * 1e3 + spot.x * 1e-3
        if (!placed || score < placed.score) placed = { sheet: si, cand, ...spot, score }
      }
    }
    if (!placed) {
      rejected.push({ part: item.part, reason: 'could not be placed even on an empty sheet' })
      continue
    }
    const { cand, x, y } = placed
    commit(skylines[placed.sheet], cand, x, y)
    const s = sheets[placed.sheet]
    s.placements.push({
      part: item.part,
      copy: item.copy,
      poly: translatePoly(cand.poly, x, y),
      engrave: cand.engrave.map((l) => l.map((q) => v2(q.x + x, q.y + y))),
      marks: cand.marks.map((m) => ({ ...m, at: v2(m.at.x + x, m.at.y + y) })),
      // No anchor means the builder found nowhere on the part the name would
      // fit. A bounding box centre is not a substitute: on a curved strip it
      // can sit clean off the part, and on a sheet packed this tightly that
      // means scribing the neighbour.
      label: cand.label ? { ...cand.label, at: v2(cand.label.at.x + x, cand.label.at.y + y) } : null,
      rotationDeg: cand.rotationDeg,
      w: cand.w,
      h: cand.h,
      x,
      y,
    })
    s.areaUsed += netArea(cand.poly)
  }

  const totalArea = sheets.length * usableL * usableW
  const used = sheets.reduce((a, s) => a + s.areaUsed, 0)
  return { sheets, rejected, yield: totalArea ? used / totalArea : 0 }
}

function netArea(p: Poly): number {
  let a = Math.abs(signedArea(p.outer))
  for (const h of p.holes) a -= Math.abs(signedArea(h))
  return Math.max(0, a)
}

/** Share of the sheet that ends up as parts rather than offcut. */
export function sheetYield(s: Sheet): number {
  return s.areaUsed / (s.width * s.length)
}
