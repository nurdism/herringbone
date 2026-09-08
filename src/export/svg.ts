import type { Sheet } from './nest'
import { simplify, V2 } from '../geom/vec'
import { strokeText } from '../geom/stroke'

/** Identical copies are told apart by a letter rather than another fraction. */
const copyTag = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : `.${i + 1}`)

const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

/**
 * One sheet as an SVG at 1:1 in millimetres.
 *   layer "cut"     black hairline, every outline and hole
 *   layer "engrave" blue, station marks, foot cut lines, part names and joint
 *                   numbers, all as single stroke paths so CAM can scribe them
 *   layer "guide"   grey, the sheet edge, not for cutting
 */
export function sheetToSvg(s: Sheet, title: string): string {
  const H = s.width
  const W = s.length
  const y = (v: number) => f(H - v) // SVG grows downward, the nest grows up

  const path = (pts: V2[]) => {
    const p = simplify(pts, 0.03)
    if (p.length < 2) return ''
    let d = `M ${f(p[0].x)} ${y(p[0].y)}`
    for (let i = 1; i < p.length; i++) d += ` L ${f(p[i].x)} ${y(p[i].y)}`
    return d + ' Z'
  }

  const cut: string[] = []
  const eng: string[] = []

  const open = (line: V2[]) => {
    const q = simplify(line, 0.02)
    if (q.length < 2) return
    let d = `M ${f(q[0].x)} ${y(q[0].y)}`
    for (let i = 1; i < q.length; i++) d += ` L ${f(q[i].x)} ${y(q[i].y)}`
    eng.push(`    <path d="${d}"/>`)
  }

  for (const pl of s.placements) {
    const ds = [path(pl.poly.outer), ...pl.poly.holes.map(path)].filter(Boolean).join(' ')
    cut.push(`    <path d="${ds}"/>`)
    for (const line of pl.engrave) open(line)
    for (const m of pl.marks) {
      for (const line of strokeText(m.text, m.at.x, m.at.y, m.size, m.align ?? 'center', m.vAlign ?? 'middle')) open(line)
    }
    if (pl.label) {
      const label = pl.part.qty > 1 ? `${pl.part.label}${copyTag(pl.copy)}` : pl.part.label
      const a = pl.label
      for (const line of strokeText(label, a.at.x, a.at.y, a.size, a.align ?? 'center', a.vAlign ?? 'middle')) open(line)
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">
  <title>${esc(title)}</title>
  <desc>Sheet ${s.index}. ${esc(s.material)}. Drawing units are millimetres at 1:1.</desc>
  <g id="guide" fill="none" stroke="#c8c8c8" stroke-width="0.5" stroke-dasharray="6 4">
    <rect x="0" y="0" width="${f(W)}" height="${f(H)}"/>
  </g>
  <g id="cut" fill="none" stroke="#000000" stroke-width="0.1" fill-rule="evenodd">
${cut.join('\n')}
  </g>
  <g id="engrave" fill="none" stroke="#0060d0" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round">
${eng.join('\n')}
  </g>
</svg>
`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
