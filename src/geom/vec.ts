export interface V2 { x: number; y: number }
export interface V3 { x: number; y: number; z: number }

export const v2 = (x: number, y: number): V2 => ({ x, y })
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })

export const add2 = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub2 = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y })
export const mul2 = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s })
export const dot2 = (a: V2, b: V2) => a.x * b.x + a.y * b.y
export const len2 = (a: V2) => Math.hypot(a.x, a.y)
export const dist2 = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y)
export const dist3 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export function norm2(a: V2): V2 {
  const l = len2(a)
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

/** A closed part outline: one outer loop plus any number of hole loops. */
export interface Poly {
  outer: V2[]
  holes: V2[][]
}

export const poly = (outer: V2[], holes: V2[][] = []): Poly => ({ outer, holes })

export function signedArea(p: V2[]): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y
  return a / 2
}

export const isCCW = (p: V2[]) => signedArea(p) > 0

export function ensureCCW(p: V2[]): V2[] {
  return isCCW(p) ? p : p.slice().reverse()
}

export function ensureCW(p: V2[]): V2[] {
  return isCCW(p) ? p.slice().reverse() : p
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bbox(pts: V2[]): BBox {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x
    if (p.y < b.minY) b.minY = p.y
    if (p.x > b.maxX) b.maxX = p.x
    if (p.y > b.maxY) b.maxY = p.y
  }
  return b
}

export const bboxW = (b: BBox) => b.maxX - b.minX
export const bboxH = (b: BBox) => b.maxY - b.minY

export function polyBBox(p: Poly): BBox {
  return bbox(p.outer)
}

/**
 * Offset a closed polygon by `d` along the outward normal (negative shrinks it).
 *
 * Miter joins with a spike clamp, then a trimming pass. The trim matters: at a
 * corner the miter reaches past the vertices just after it, so those vertices
 * fold back and leave a small lip sticking out of the offset outline. Any edge
 * that ends up running opposite to the edge it came from is exactly that fold,
 * so its far vertex is dropped until none are left.
 */
export function offsetPolygon(pts: V2[], d: number, miterLimit = 3): V2[] {
  const n = pts.length
  if (n < 3 || Math.abs(d) < 1e-9) return pts.slice()
  const ccw = isCCW(pts)
  // An offset cannot resolve detail finer than the offset distance. Sampling
  // bunches points where a surface turns hard, and offsetting across a 0.3 mm
  // edge by 4 mm inverts it, which is what leaves a lip on the outline. Thin
  // the near collinear points out first; real corners survive untouched.
  const raw = ccw ? pts : pts.slice().reverse()
  const src = thinForOffset(
    simplify(raw, Math.max(0.015, Math.abs(d) * 0.015)),
    Math.abs(d) * 0.4,
  )
  const out: V2[] = []
  for (let i = 0; i < src.length; i++) {
    const p = src[(i - 1 + src.length) % src.length]
    const c = src[i]
    const q = src[(i + 1) % src.length]
    const e1 = norm2(sub2(c, p))
    const e2 = norm2(sub2(q, c))
    const n1 = v2(e1.y, -e1.x) // outward for a CCW loop
    const n2 = v2(e2.y, -e2.x)
    let bis = add2(n1, n2)
    if (len2(bis) < 1e-9) bis = n2
    bis = norm2(bis)
    const cosHalf = dot2(bis, n2)
    const scale = Math.min(miterLimit, 1 / Math.max(0.15, Math.abs(cosHalf)))
    out.push(add2(c, mul2(bis, d * scale)))
  }

  const clean = unfold(trimFolds(out, src))
  return ccw ? clean : clean.reverse()
}

/**
 * Drop edges shorter than the offset distance where the outline is smooth.
 *
 * An offset cannot resolve detail finer than the offset itself. Sampling
 * bunches points where a surface turns hard, and offsetting across a tenth of
 * a millimetre by three millimetres inverts that edge, which is what leaves a
 * lip on the outline. Vertices carrying a real corner are kept whatever their
 * spacing, so shapes only lose detail the offset could not have carried.
 */
function thinForOffset(pts: V2[], minLen: number, maxTurn = 25): V2[] {
  if (pts.length < 5 || minLen <= 0) return pts
  const cosLimit = Math.cos((maxTurn * Math.PI) / 180)
  let work = pts
  for (let pass = 0; pass < 6; pass++) {
    const out: V2[] = []
    let dropped = false
    for (let i = 0; i < work.length; i++) {
      const prev = out.length ? out[out.length - 1] : work[(i - 1 + work.length) % work.length]
      const cur = work[i]
      const next = work[(i + 1) % work.length]
      const din = sub2(cur, prev)
      const dout = sub2(next, cur)
      const lin = len2(din)
      const lout = len2(dout)
      if (out.length > 1 && lin < minLen && lin > 0 && lout > 0) {
        const turn = dot2(din, dout) / (lin * lout)
        if (turn > cosLimit) { dropped = true; continue } // smooth here, not a corner
      }
      out.push(cur)
    }
    work = out
    if (!dropped || work.length < 5) break
  }
  return work
}

/** Where two segments cross, or null. Endpoints touching does not count. */
function segCross(a1: V2, a2: V2, b1: V2, b2: V2): V2 | null {
  const rx = a2.x - a1.x, ry = a2.y - a1.y
  const sx = b2.x - b1.x, sy = b2.y - b1.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / den
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / den
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null
  return v2(a1.x + rx * t, a1.y + ry * t)
}

/**
 * Remove the small self intersecting loops an inward offset leaves behind at a
 * corner. They are always local, so only nearby edge pairs are tested and the
 * whole thing stays linear in practice.
 */
function unfold(loop: V2[], window = 16): V2[] {
  let pts = loop
  for (let pass = 0; pass < 12; pass++) {
    let cut: { i: number; j: number; at: V2 } | null = null
    for (let i = 0; i < pts.length - 2 && !cut; i++) {
      const a1 = pts[i]
      const a2 = pts[i + 1]
      for (let j = i + 2; j < Math.min(pts.length - 1, i + window); j++) {
        const at = segCross(a1, a2, pts[j], pts[j + 1])
        if (at) { cut = { i, j, at }; break }
      }
    }
    if (!cut) break
    const next = pts.slice(0, cut.i + 1)
    next.push(cut.at)
    next.push(...pts.slice(cut.j + 1))
    if (next.length < 4) break
    pts = next
  }
  return pts
}

function trimFolds(out: V2[], src: V2[]): V2[] {
  const keptSrc = src.slice()
  for (let guard = 0; guard < src.length && out.length > 3; guard++) {
    let fold = -1
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length
      const before = sub2(keptSrc[j], keptSrc[i])
      const after = sub2(out[j], out[i])
      if (len2(before) < 1e-9 || len2(after) < 1e-9) continue
      if (dot2(before, after) < 0) { fold = j; break }
    }
    if (fold < 0) break
    out.splice(fold, 1)
    keptSrc.splice(fold, 1)
  }
  return out
}

/** Offset every loop of a part: outer grows by d, holes shrink so the web keeps its width. */
export function offsetPoly(p: Poly, d: number): Poly {
  return {
    outer: offsetPolygon(ensureCCW(p.outer), d),
    holes: p.holes.map((h) => offsetPolygon(ensureCW(h), d)),
  }
}

export function translatePoly(p: Poly, dx: number, dy: number): Poly {
  const t = (l: V2[]) => l.map((q) => v2(q.x + dx, q.y + dy))
  return { outer: t(p.outer), holes: p.holes.map(t) }
}

export function rotatePoly(p: Poly, rad: number): Poly {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const r = (l: V2[]) => l.map((q) => v2(q.x * c - q.y * s, q.x * s + q.y * c))
  return { outer: r(p.outer), holes: p.holes.map(r) }
}

/** Move a part so its bounding box starts at the origin. */
export function normalizePoly(p: Poly): Poly {
  const b = polyBBox(p)
  return translatePoly(p, -b.minX, -b.minY)
}

/** Even odd point in polygon. Boundary cases are not meaningful here. */
export function pointInPolygon(pt: V2, poly: V2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (
      poly[i].y > pt.y !== poly[j].y > pt.y &&
      pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x
    ) inside = !inside
  }
  return inside
}

export function polylineLength(pts: V2[], closed = false): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist2(pts[i - 1], pts[i])
  if (closed && pts.length > 1) l += dist2(pts[pts.length - 1], pts[0])
  return l
}

/** Cumulative arc length, normalized to 0..1. Returns pts.length values. */
export function arcParam(pts: V2[]): number[] {
  const acc = [0]
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist2(pts[i - 1], pts[i]))
  const total = acc[acc.length - 1] || 1
  return acc.map((a) => a / total)
}

/** Point at normalized arc length t along an open polyline. */
export function atArc(pts: V2[], par: number[], t: number): V2 {
  const u = Math.min(1, Math.max(0, t))
  let i = 1
  while (i < par.length - 1 && par[i] < u) i++
  const f = (u - par[i - 1]) / Math.max(1e-12, par[i] - par[i - 1])
  return v2(
    pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
    pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
  )
}

/** Slice an open polyline between two normalized arc positions, keeping interior vertices. */
export function sliceArc(pts: V2[], par: number[], t0: number, t1: number): V2[] {
  const out = [atArc(pts, par, t0)]
  for (let i = 0; i < pts.length; i++) {
    if (par[i] > t0 + 1e-9 && par[i] < t1 - 1e-9) out.push(pts[i])
  }
  out.push(atArc(pts, par, t1))
  return out
}

/** Drop vertices that add nothing, so exported paths stay small. */
export function simplify(pts: V2[], tol = 0.05): V2[] {
  if (pts.length < 3) return pts.slice()
  const out: V2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    // perpendicular distance of b from the line a..c
    const ax = c.x - a.x
    const ay = c.y - a.y
    const l = Math.hypot(ax, ay)
    const d = l < 1e-12 ? dist2(a, b) : Math.abs(ax * (a.y - b.y) - ay * (a.x - b.x)) / l
    if (d > tol) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

export function circlePts(cx: number, cy: number, r: number, seg = 48): V2[] {
  const out: V2[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    out.push(v2(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
  }
  return out
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
