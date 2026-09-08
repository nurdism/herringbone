import earcut from 'earcut'
import { Hull } from './hull'
import { plankLimits, railSeat } from './frame'
import { Poly, V2, ensureCCW, ensureCW } from './vec'

/** A triangle soup. Nine floats per triangle, ready for STL or three.js. */
export type Mesh = Float32Array

function pushTri(out: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
}

/**
 * Extrude a part from z=0 to z=t. The part's design plane becomes the local
 * x/y plane, so a rib comes out lying flat and ready to be placed.
 */
export function extrudePoly(p: Poly, t: number): Mesh {
  const outer = ensureCCW(p.outer)
  const holes = p.holes.map((h) => ensureCW(h))

  const flat: number[] = []
  const holeIdx: number[] = []
  for (const q of outer) flat.push(q.x, q.y)
  for (const h of holes) {
    holeIdx.push(flat.length / 2)
    for (const q of h) flat.push(q.x, q.y)
  }
  const tris = earcut(flat, holeIdx, 2)

  const out: number[] = []
  const px = (i: number) => flat[i * 2]
  const py = (i: number) => flat[i * 2 + 1]

  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]]
    // bottom cap, wound so the normal points down
    pushTri(out, px(a), py(a), 0, px(c), py(c), 0, px(b), py(b), 0)
    // top cap
    pushTri(out, px(a), py(a), t, px(b), py(b), t, px(c), py(c), t)
  }

  const wall = (loop: V2[]) => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue
      pushTri(out, a.x, a.y, 0, b.x, b.y, 0, b.x, b.y, t)
      pushTri(out, a.x, a.y, 0, b.x, b.y, t, a.x, a.y, t)
    }
  }
  wall(outer)
  for (const h of holes) wall(h)

  return new Float32Array(out)
}

export function transformMesh(m: Mesh, f: (x: number, y: number, z: number) => [number, number, number]): Mesh {
  const out = new Float32Array(m.length)
  for (let i = 0; i < m.length; i += 3) {
    const [x, y, z] = f(m[i], m[i + 1], m[i + 2])
    out[i] = x
    out[i + 1] = y
    out[i + 2] = z
  }
  return out
}

export function mergeMeshes(list: Mesh[]): Mesh {
  let n = 0
  for (const m of list) n += m.length
  const out = new Float32Array(n)
  let o = 0
  for (const m of list) {
    out.set(m, o)
    o += m.length
  }
  return out
}

/** Place a rib: its design (y, z) plane is normal to the board's x axis. */
export function placeRib(m: Mesh, station: number, t: number): Mesh {
  return transformMesh(m, (lx, ly, lz) => [station - t / 2 + lz, lx, ly])
}

/** Place a stringer: its design (x, z) plane is the board's centreline plane. */
export function placeStringer(m: Mesh, t: number): Mesh {
  return transformMesh(m, (lx, ly, lz) => [lx, -t / 2 + lz, ly])
}

/**
 * The outer rail plank as a solid band, with its mortises cut.
 *
 * The band lies on the flat rail, so its inner face is the outer one pushed
 * straight in along the plan outline's normal. Quads whose centre falls inside
 * a mortise are left out: the plank is a preview and a reference solid, not a
 * cut file, and a window in the right place reads better than an exact edge.
 */
export function plankMesh(h: Hull, stations: number[], samples = 161, quarter = 30): Mesh {
  const p = h.p
  if (!p.outerPlank) return new Float32Array(0)
  const limits = plankLimits(h)
  if (!limits) return new Float32Array(0)
  // match the cut part: it stops a shoulder past its outermost mortise
  const mine = stations.filter((s) => s > limits[0] && s < limits[1])
  if (mine.length < 2) return new Float32Array(0)
  const shoulder = Math.max(p.plyThickness * 2, p.length * 0.004)
  const [ux0, ux1] = [
    h.uOf(Math.max(limits[0], mine[0] - shoulder)),
    h.uOf(Math.min(limits[1], mine[mine.length - 1] + shoulder)),
  ]
  const t = p.outerPlankThickness
  const slotHalf = (p.plyThickness + p.slotClearance) / 2
  const bandStart = quarter
  const bandEnd = quarter + Math.max(2, Math.round(quarter / 3))

  interface Row { x: number; nx: number; ny: number; band: V2[]; seat: ReturnType<typeof railSeat> }
  const rows: Row[] = []
  for (let i = 0; i < samples; i++) {
    const u = ux0 + (ux1 - ux0) * (0.5 - 0.5 * Math.cos((i / (samples - 1)) * Math.PI))
    const x = h.xOf(u)
    const du = 0.5 / samples
    const a = Math.max(0, u - du)
    const b = Math.min(1, u + du)
    const dx = h.xOf(b) - h.xOf(a)
    const dy = h.halfWidth(b) - h.halfWidth(a)
    const l = Math.hypot(dx, dy) || 1
    // outward normal of the plan outline on the +y side
    rows.push({ x, nx: -dy / l, ny: dx / l, band: h.halfSection(u, quarter).slice(bandStart, bandEnd + 1), seat: railSeat(h, x) })
  }

  const out: number[] = []
  const inMortise = (x: number, z: number, r: Row) => {
    if (!r.seat) return false
    if (Math.abs(z - r.seat.railZ) > r.seat.tenonHalf) return false
    return stations.some((s) => Math.abs(x - s) <= slotHalf)
  }

  for (const side of [1, -1] as const) {
    for (let i = 0; i < rows.length - 1; i++) {
      const r0 = rows[i]
      const r1 = rows[i + 1]
      const m = Math.min(r0.band.length, r1.band.length)
      for (let j = 0; j < m - 1; j++) {
        const mx = (r0.x + r1.x) / 2
        const mz = (r0.band[j].y + r1.band[j + 1].y) / 2
        const hole = inMortise(mx, mz, r0)
        const face = (inner: boolean) => {
          const pt = (r: Row, k: number): [number, number, number] => {
            const q = r.band[k]
            const d = inner ? t : 0
            return [r.x - r.nx * d, (q.x - r.ny * d) * side, q.y]
          }
          const A = pt(r0, j)
          const B = pt(r1, j)
          const C = pt(r1, j + 1)
          const D = pt(r0, j + 1)
          const flip = (side === 1) === inner
          if (flip) { pushTri(out, ...A, ...C, ...B); pushTri(out, ...A, ...D, ...C) }
          else { pushTri(out, ...A, ...B, ...C); pushTri(out, ...A, ...C, ...D) }
        }
        if (hole) {
          // walls around the window so it does not read as a gap in the solid
          const edge = (k: number) => {
            const o0 = [r0.x, r0.band[k].x * side, r0.band[k].y] as [number, number, number]
            const o1 = [r1.x, r1.band[k].x * side, r1.band[k].y] as [number, number, number]
            const i0 = [r0.x - r0.nx * t, (r0.band[k].x - r0.ny * t) * side, r0.band[k].y] as [number, number, number]
            const i1 = [r1.x - r1.nx * t, (r1.band[k].x - r1.ny * t) * side, r1.band[k].y] as [number, number, number]
            pushTri(out, ...o0, ...o1, ...i1)
            pushTri(out, ...o0, ...i1, ...i0)
          }
          if (!inMortise((r0.x + r1.x) / 2, r0.band[j].y, r0)) edge(j)
          continue
        }
        face(false)
        face(true)
      }
      // top and bottom edges of the band
      for (const k of [0, m - 1]) {
        const o0 = [r0.x, r0.band[k].x * side, r0.band[k].y] as [number, number, number]
        const o1 = [r1.x, r1.band[k].x * side, r1.band[k].y] as [number, number, number]
        const i0 = [r0.x - r0.nx * t, (r0.band[k].x - r0.ny * t) * side, r0.band[k].y] as [number, number, number]
        const i1 = [r1.x - r1.nx * t, (r1.band[k].x - r1.ny * t) * side, r1.band[k].y] as [number, number, number]
        if ((k === 0) === (side === 1)) { pushTri(out, ...o0, ...o1, ...i1); pushTri(out, ...o0, ...i1, ...i0) }
        else { pushTri(out, ...o0, ...i1, ...o1); pushTri(out, ...o0, ...i0, ...i1) }
      }
    }

    // Blunt ends. The plank stops with a real section on it, so those ends are
    // open faces that have to be closed or the solid reads as a shell.
    for (const r of [rows[0], rows[rows.length - 1]]) {
      const m = r.band.length
      for (let j = 0; j < m - 1; j++) {
        const o0 = [r.x, r.band[j].x * side, r.band[j].y] as [number, number, number]
        const o1 = [r.x, r.band[j + 1].x * side, r.band[j + 1].y] as [number, number, number]
        const i0 = [r.x - r.nx * t, (r.band[j].x - r.ny * t) * side, r.band[j].y] as [number, number, number]
        const i1 = [r.x - r.nx * t, (r.band[j + 1].x - r.ny * t) * side, r.band[j + 1].y] as [number, number, number]
        pushTri(out, ...o0, ...o1, ...i1)
        pushTri(out, ...o0, ...i1, ...i0)
      }
    }
  }
  return new Float32Array(out)
}

/** The outer skin of the board as a closed shell, for preview and reference STL. */
export function hullMesh(h: Hull, stations = 141, quarter = 30, u0 = 0, u1 = 1): Mesh {
  const rows = h.surfaceGrid(stations, quarter, u0, u1)
  const out: number[] = []
  const pt = (r: number, j: number, side: 1 | -1): [number, number, number] => {
    const row = rows[r]
    const q = row.half[j]
    return [h.xOf(row.u), q.x * side, q.y]
  }

  for (let r = 0; r < rows.length - 1; r++) {
    const m = Math.min(rows[r].half.length, rows[r + 1].half.length)
    for (let j = 0; j < m - 1; j++) {
      for (const side of [1, -1] as const) {
        const a = pt(r, j, side)
        const b = pt(r + 1, j, side)
        const c = pt(r + 1, j + 1, side)
        const d = pt(r, j + 1, side)
        if (side === 1) {
          pushTri(out, ...a, ...b, ...c)
          pushTri(out, ...a, ...c, ...d)
        } else {
          pushTri(out, ...a, ...c, ...b)
          pushTri(out, ...a, ...d, ...c)
        }
      }
    }
  }

  // flat caps on the squared tail and nose
  for (const [r, flip] of [[0, true], [rows.length - 1, false]] as const) {
    const row = rows[r]
    const m = row.half.length
    const x = h.xOf(row.u)
    let cz = 0
    for (const q of row.half) cz += q.y
    cz /= m
    for (let j = 0; j < m - 1; j++) {
      for (const side of [1, -1] as const) {
        const a: [number, number, number] = [x, row.half[j].x * side, row.half[j].y]
        const b: [number, number, number] = [x, row.half[j + 1].x * side, row.half[j + 1].y]
        const c: [number, number, number] = [x, 0, cz]
        const front = (side === 1) !== flip
        if (front) pushTri(out, ...a, ...b, ...c)
        else pushTri(out, ...a, ...c, ...b)
      }
    }
  }

  return new Float32Array(out)
}
