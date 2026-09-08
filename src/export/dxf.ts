import type { Sheet } from './nest'
import { simplify, V2 } from '../geom/vec'
import { strokeText } from '../geom/stroke'

/** Identical copies are told apart by a letter rather than another fraction. */
const copyTag = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : `.${i + 1}`)

/**
 * AC1009 (R12) DXF using POLYLINE/VERTEX. R12 is the dialect every laser and
 * router control seems to agree on, so it is what we emit.
 * Layers: CUT for everything that is cut through, ENGRAVE for scribed lines.
 * Text is emitted as single stroke polylines rather than TEXT entities, so it
 * engraves the same on any controller without needing a font.
 */
export function sheetToDxf(s: Sheet): string {
  const o: string[] = []
  const g = (code: number, val: string | number) => { o.push(String(code), String(val)) }
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

  g(0, 'SECTION'); g(2, 'HEADER')
  g(9, '$ACADVER'); g(1, 'AC1009')
  g(9, '$INSUNITS'); g(70, 4) // millimetres
  g(9, '$EXTMIN'); g(10, '0.0'); g(20, '0.0')
  g(9, '$EXTMAX'); g(10, n(s.length)); g(20, n(s.width))
  g(0, 'ENDSEC')

  g(0, 'SECTION'); g(2, 'TABLES')
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, 2)
  for (const [name, color] of [['CUT', 7], ['ENGRAVE', 5]] as const) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC')

  g(0, 'SECTION'); g(2, 'ENTITIES')

  const polyline = (pts: V2[], layer: string, closed: boolean) => {
    const p = simplify(pts, 0.03)
    if (p.length < 2) return
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, closed ? 1 : 0)
    g(10, '0.0'); g(20, '0.0'); g(30, '0.0')
    for (const q of p) {
      g(0, 'VERTEX'); g(8, layer); g(10, n(q.x)); g(20, n(q.y)); g(30, '0.0')
    }
    g(0, 'SEQEND'); g(8, layer)
  }

  for (const pl of s.placements) {
    polyline(pl.poly.outer, 'CUT', true)
    for (const h of pl.poly.holes) polyline(h, 'CUT', true)
    for (const line of pl.engrave) polyline(line, 'ENGRAVE', false)
    for (const m of pl.marks) {
      for (const line of strokeText(m.text, m.at.x, m.at.y, m.size, m.align ?? 'center', m.vAlign ?? 'middle')) {
        polyline(line, 'ENGRAVE', false)
      }
    }
    if (pl.label) {
      const label = pl.part.qty > 1 ? `${pl.part.label}${copyTag(pl.copy)}` : pl.part.label
      const a = pl.label
      for (const line of strokeText(label, a.at.x, a.at.y, a.size, a.align ?? 'center', a.vAlign ?? 'middle')) {
        polyline(line, 'ENGRAVE', false)
      }
    }
  }

  g(0, 'ENDSEC')
  g(0, 'EOF')
  return o.join('\r\n') + '\r\n'
}
