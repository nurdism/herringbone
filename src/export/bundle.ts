import JSZip from 'jszip'
import type { BoardModel } from '../model'
import type { Part } from '../geom/frame'
import { extrudePoly, hullMesh, mergeMeshes, Mesh, placeRib, plankMesh, transformMesh } from '../geom/mesh'
import { normalizePoly } from '../geom/vec'
import { meshToStl } from './stl'
import { sheetToSvg } from './svg'
import { sheetToDxf } from './dxf'
import { buildDoc, cutlistCsv, linesCsv, offsetsCsv } from './docs'

/** Every frame part as one mesh, positioned the way it goes together. */
export function assembledFrameMesh(m: BoardModel): Mesh {
  const meshes: Mesh[] = []
  for (const rib of m.frame.ribs) {
    meshes.push(placeRib(extrudePoly(rib.poly, rib.thickness), rib.station!, rib.thickness))
  }
  for (const st of m.frame.stringers) {
    const y = st.offsetY ?? 0
    for (const side of y === 0 ? [0] : [y, -y]) {
      meshes.push(
        transformMesh(extrudePoly(st.poly, st.thickness), (lx, ly, lz) => [lx, side - st.thickness / 2 + lz, ly]),
      )
    }
  }
  // the rail planks are tenoned onto the rib ends, so they belong to the
  // assembly rather than to the loose planking
  const rail = plankMesh(m.hull, m.frame.stations)
  if (rail.length) meshes.push(rail)
  return mergeMeshes(meshes)
}

/** One part, laid flat at the origin, ready to slice for a printer. */
export function flatPartMesh(part: Part): Mesh {
  return extrudePoly(normalizePoly(part.poly), part.thickness)
}

const blobBytes = (b: Blob) => b.arrayBuffer()

export async function buildBundle(m: BoardModel): Promise<{ blob: Blob; name: string; fileCount: number }> {
  const zip = new JSZip()
  const root = `sup-${m.params.name}`
  const dir = zip.folder(root)!
  let fileCount = 0
  const add = (path: string, data: string | ArrayBuffer) => {
    dir.file(path, data)
    fileCount++
  }

  add('README.md', buildDoc(m))
  add('cutlist.csv', cutlistCsv(m))
  add('offsets.csv', offsetsCsv(m))
  add('lines.csv', linesCsv(m))
  add('params.json', JSON.stringify(m.params, null, 2))

  for (const s of m.frameNest.sheets) {
    const nm = `frame_sheet_${String(s.index).padStart(2, '0')}`
    add(`2d/svg/${nm}.svg`, sheetToSvg(s, `${m.params.name} frame sheet ${s.index}`))
    add(`2d/dxf/${nm}.dxf`, sheetToDxf(s))
  }
  for (const s of m.jigNest?.sheets ?? []) {
    const nm = `jig_sheet_${String(s.index).padStart(2, '0')}`
    add(`2d/svg/${nm}.svg`, sheetToSvg(s, `${m.params.name} jig sheet ${s.index}`))
    add(`2d/dxf/${nm}.dxf`, sheetToDxf(s))
  }
  for (const s of m.foamNest?.sheets ?? []) {
    const nm = `foam_sheet_${String(s.index).padStart(2, '0')}`
    add(`2d/svg/${nm}.svg`, sheetToSvg(s, `${m.params.name} foam sheet ${s.index}`))
    add(`2d/dxf/${nm}.dxf`, sheetToDxf(s))
  }
  for (const s of m.skinNest.sheets) {
    const nm = `skin_sheet_${String(s.index).padStart(2, '0')}`
    add(`2d/svg/${nm}.svg`, sheetToSvg(s, `${m.params.name} skin sheet ${s.index}`))
    add(`2d/dxf/${nm}.dxf`, sheetToDxf(s))
  }

  add('3d/frame_assembled.stl', await blobBytes(meshToStl(assembledFrameMesh(m), `${m.params.name} frame`)))
  add('3d/hull_shape.stl', await blobBytes(meshToStl(hullMesh(m.hull), `${m.params.name} hull`)))
  const railSolid = plankMesh(m.hull, m.frame.stations)
  if (railSolid.length) add('3d/rail_plank.stl', await blobBytes(meshToStl(railSolid, `${m.params.name} rail plank`)))
  for (const part of [...m.frameParts, ...m.jigParts, ...m.foamParts]) {
    add(`3d/parts/${part.id}.stl`, await blobBytes(meshToStl(flatPartMesh(part), part.id)))
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob, name: `${root}.zip`, fileCount }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const textBlob = (s: string, type: string) => new Blob([s], { type })
