import type { Params } from '../params'
import { minPlankBand } from '../params'
import { V2, V3, v2, v3, clamp, arcParam, atArc, signedArea, polylineLength } from './vec'

/**
 * The board lives in a right handed frame:
 *   x  runs tail (0) to nose (length)
 *   y  runs across, 0 on the centreline, positive to the right looking forward
 *   z  runs up, 0 is the lowest point of the bottom
 *
 * Everything is generated from closed form curves, so any shape the UI can
 * reach is guaranteed to be well behaved. No control points to tangle.
 */

/**
 * A taper curve on s in 0..1 that is 1 at s=0 and `endFrac` at s=1.
 * `n` controls how long it holds full value, `m` how blunt the end is.
 */
function taper(endFrac: number, n: number, m: number): (s: number) => number {
  const e = clamp(endFrac, 1e-4, 0.999)
  // solve (1 - sMax^n)^(1/m) = e
  const sMax = Math.pow(Math.max(1e-6, 1 - Math.pow(e, m)), 1 / n)
  return (s: number) => {
    const t = clamp(s, 0, 1) * sMax
    return Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / m)
  }
}

export interface Section {
  u: number
  x: number
  halfWidth: number
  thickness: number
  bottomZ: number
  topZ: number
  railZ: number
  /** Bottom and top of the flat rail band. Equal when the rail is not flattened. */
  railLowZ: number
  railHighZ: number
}

export class Hull {
  readonly p: Params
  private tailPlan: (s: number) => number
  private nosePlan: (s: number) => number
  private tailThick: (s: number) => number
  private noseThick: (s: number) => number

  constructor(p: Params) {
    this.p = p
    this.tailPlan = taper(p.tailWidthFrac, p.planFullness, p.planEndFullness)
    this.nosePlan = taper(p.noseWidthFrac, p.planFullness, p.planEndFullness)
    this.tailThick = taper(p.tailThickFrac, p.thickFullness, p.thickFullness)
    this.noseThick = taper(p.noseThickFrac, p.thickFullness, p.thickFullness)
  }

  /** Normalized station 0..1 for an absolute x. */
  uOf(x: number) { return clamp(x / this.p.length, 0, 1) }
  xOf(u: number) { return u * this.p.length }

  private sides(u: number) {
    const p = this.p.widePoint
    return u <= p
      ? { tail: true, s: (p - u) / Math.max(1e-6, p) }
      : { tail: false, s: (u - p) / Math.max(1e-6, 1 - p) }
  }

  halfWidth(u: number): number {
    const { tail, s } = this.sides(u)
    const f = tail ? this.tailPlan(s) : this.nosePlan(s)
    return (this.p.width / 2) * f
  }

  thicknessAt(u: number): number {
    const { tail, s } = this.sides(u)
    const f = tail ? this.tailThick(s) : this.noseThick(s)
    return this.p.thickness * f
  }

  /** Bottom of the board on the centreline: the rocker line. */
  bottomZ(u: number): number {
    const p = this.p
    const t = clamp((p.rockerTailStart - u) / Math.max(1e-6, p.rockerTailStart), 0, 1)
    const n = clamp((u - p.rockerNoseStart) / Math.max(1e-6, 1 - p.rockerNoseStart), 0, 1)
    return p.tailRocker * Math.pow(t, p.rockerExp) + p.noseRocker * Math.pow(n, p.rockerExp)
  }

  topZ(u: number): number { return this.bottomZ(u) + this.thicknessAt(u) }

  section(u: number): Section {
    const t = this.thicknessAt(u)
    const zb = this.bottomZ(u)
    const railZ = zb + t * this.p.railFrac
    // A flat rail is a vertical band at the widest point. Both the deck and the
    // hull have to keep enough height above and below it to turn away from
    // vertical, or the turn is crowded into a radius the skin cannot bend
    // around and an inward offset cannot resolve. That reserve scales with the
    // section: held at a fixed size it swallows a thin nose whole and closes
    // the band to nothing exactly where the rail plank still has to reach.
    const turn = Math.min(this.p.skinThickness * 8, t * 0.2)
    const below = Math.max(0, railZ - zb - turn)
    const above = Math.max(0, zb + t - railZ - turn)
    const room = 2 * Math.min(below, above)
    let flat = Math.min(t * this.p.railFlat, room)
    // With a rail plank fitted the band has to stay usable right out to the
    // tips, so it holds a floor wherever the section can carry one.
    if (this.p.outerPlank) flat = Math.min(room, Math.max(flat, minPlankBand(this.p)))
    return {
      u,
      x: this.xOf(u),
      halfWidth: this.halfWidth(u),
      thickness: t,
      bottomZ: zb,
      topZ: zb + t,
      railZ,
      railLowZ: railZ - flat / 2,
      railHighZ: railZ + flat / 2,
    }
  }

  /** Local vee rise at the rail, tapering with the local width. */
  private vee(sec: Section): number {
    const scale = sec.halfWidth / Math.max(1e-6, this.p.width / 2)
    return Math.min(this.p.bottomVee * scale, (sec.railLowZ - sec.bottomZ) * 0.8)
  }

  /** Bottom surface height at transverse fraction v (0 keel, 1 rail). */
  hullZ(sec: Section, v: number): number {
    const vv = clamp(v, 0, 1)
    const ve = this.vee(sec)
    const rise = sec.railLowZ - sec.bottomZ
    return sec.bottomZ + (rise - ve) * Math.pow(vv, this.p.hullFlat) + ve * vv
  }

  /** Deck surface height at transverse fraction v (0 centre, 1 rail). */
  deckZ(sec: Section, v: number): number {
    const vv = clamp(v, 0, 1)
    const above = sec.topZ - sec.railHighZ
    return sec.railHighZ + above * Math.pow(Math.max(0, 1 - Math.pow(vv, this.p.deckCrown)), 1 / 2.2)
  }

  /**
   * Half of a station in the (y, z) plane, keel first, deck centre last,
   * on the +y side. Cosine spaced so the rail gets the sample density.
   */
  halfSection(u: number, quarterSamples = 34): V2[] {
    const sec = this.section(u)
    const pts: V2[] = []
    // keel -> bottom of the rail, sine spaced so samples bunch where it turns
    for (let i = 0; i <= quarterSamples; i++) {
      const v = Math.sin((i / quarterSamples) * (Math.PI / 2))
      pts.push(v2(sec.halfWidth * v, this.hullZ(sec, v)))
    }
    // Straight up the flat rail band. The points are emitted even when the
    // band has no height, so every station returns the same number of samples:
    // the surface mesh pairs rows index by index and would tear otherwise.
    const band = sec.railHighZ - sec.railLowZ
    const steps = Math.max(2, Math.round(quarterSamples / 3))
    for (let i = 1; i <= steps; i++) {
      pts.push(v2(sec.halfWidth, sec.railLowZ + (band * i) / steps))
    }
    // top of the rail -> deck centre
    for (let i = 1; i <= quarterSamples; i++) {
      const v = Math.cos((i / quarterSamples) * (Math.PI / 2))
      pts.push(v2(sec.halfWidth * v, this.deckZ(sec, v)))
    }
    return pts
  }

  /** Full closed station outline in (y, z), wound counter clockwise. */
  sectionOutline(u: number, quarterSamples = 34): V2[] {
    const half = this.halfSection(u, quarterSamples)
    const out: V2[] = []
    // deck, right rail to left rail (walk the half backwards, then mirror forwards)
    for (let i = half.length - 1; i >= 0; i--) out.push(half[i])
    for (let i = 1; i < half.length - 1; i++) out.push(v2(-half[i].x, half[i].y))
    const closed = out
    return signedArea(closed) > 0 ? closed : closed.reverse()
  }

  /** Cross sectional area at a station, in mm^2. */
  sectionArea(u: number): number {
    return Math.abs(signedArea(this.sectionOutline(u, 40)))
  }

  /** Displacement volume in litres, by integrating the station areas. */
  volumeLitres(steps = 400): number {
    let vol = 0
    const dx = this.p.length / steps
    for (let i = 0; i < steps; i++) {
      const a0 = this.sectionArea((i + 0.0) / steps)
      const a1 = this.sectionArea((i + 0.5) / steps)
      const a2 = this.sectionArea((i + 1.0) / steps)
      vol += (dx / 6) * (a0 + 4 * a1 + a2) // Simpson over the sub interval
    }
    return vol / 1e6
  }

  /** Wetted length of the bottom centreline, useful in the build notes. */
  rockerLineLength(steps = 300): number {
    const pts: V2[] = []
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      pts.push(v2(this.xOf(u), this.bottomZ(u)))
    }
    return polylineLength(pts)
  }

  /** 3D point on the outer skin. `s` is normalized arc length on the half section. */
  surfacePoint(u: number, s: number, side: 1 | -1 = 1, quarterSamples = 34): V3 {
    const half = this.halfSection(u, quarterSamples)
    const par = arcParam(half)
    const q = atArc(half, par, s)
    return v3(this.xOf(u), q.x * side, q.y)
  }

  /**
   * The whole outer surface as a station grid, for the 3D preview and the
   * hull STL. Returns [station][halfSection point] on the +y side only.
   */
  surfaceGrid(stations = 121, quarterSamples = 30, u0 = 0, u1 = 1): { u: number; half: V2[] }[] {
    const rows: { u: number; half: V2[] }[] = []
    for (let i = 0; i < stations; i++) {
      // cosine spacing puts detail into the nose and tail where curvature is
      const t = 0.5 - 0.5 * Math.cos((i / (stations - 1)) * Math.PI)
      const u = u0 + (u1 - u0) * t
      rows.push({ u, half: this.halfSection(u, quarterSamples) })
    }
    return rows
  }
}
