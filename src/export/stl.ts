import type { Mesh } from '../geom/mesh'

/** Binary STL. Units are whatever the mesh is in, which here is millimetres. */
export function meshToStl(m: Mesh, header = 'herringbone'): Blob {
  const tris = Math.floor(m.length / 9)
  const buf = new ArrayBuffer(84 + tris * 50)
  const dv = new DataView(buf)
  const head = new Uint8Array(buf, 0, 80)
  const bytes = new TextEncoder().encode(header.slice(0, 79))
  head.set(bytes)

  let kept = 0
  let o = 84
  for (let i = 0; i < tris; i++) {
    const b = i * 9
    const ax = m[b], ay = m[b + 1], az = m[b + 2]
    const bx = m[b + 3], by = m[b + 4], bz = m[b + 5]
    const cx = m[b + 6], cy = m[b + 7], cz = m[b + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    // slivers from triangulating a near collinear fan help nobody downstream
    if (!(l > 1e-9)) continue
    nx /= l; ny /= l; nz /= l
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true)
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true)
    dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true)
    dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true)
    dv.setUint16(o + 48, 0, true)
    o += 50
    kept++
  }
  dv.setUint32(80, kept, true)
  return new Blob([buf.slice(0, 84 + kept * 50)], { type: 'model/stl' })
}

export async function stlBytes(m: Mesh, header?: string): Promise<Uint8Array> {
  const b = meshToStl(m, header)
  return new Uint8Array(await b.arrayBuffer())
}
