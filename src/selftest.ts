/**
 * Self test for the generator. Run with `npm run check`.
 *
 * There is no DOM here, so this covers the half that matters: the geometry,
 * the nesting and the exported files. Set N to change the fuzz count.
 */
import { buildCore, buildModel } from './model'
import { DEFAULTS, Params, PRESETS, sanitize } from './params'
import { GROUPS } from './ui/schema'
import { bbox, ensureCCW, offsetPolygon, polyBBox, signedArea, V2 } from './geom/vec'
import { extrudePoly, hullMesh } from './geom/mesh'
import { assembledFrameMesh, buildBundle, flatPartMesh } from './export/bundle'
import { meshToStl } from './export/stl'
import { sheetToDxf } from './export/dxf'
import { sheetToSvg } from './export/svg'
import { Sheet, sheetYield } from './export/nest'
import { strokeText } from './geom/stroke'
import { panelBottomZ, panelTopZ, plankLimits, plankLive } from './geom/frame'

let failures = 0
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`) }
const head = (t: string) => console.log(`\n${t}\n${'-'.repeat(t.length)}`)

// ---------------------------------------------------------------- helpers

function segInt(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}
function inside(pt: V2, poly: V2[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > pt.y) !== (poly[j].y > pt.y) &&
        pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
  }
  return c
}
const inPart = (pt: V2, p: { outer: V2[]; holes: V2[][] }) =>
  inside(pt, p.outer) && !p.holes.some((h) => inside(pt, h))

function collide(A: V2[], B: V2[]): boolean {
  const ba = bbox(A), bb = bbox(B)
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (segInt(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true
    }
  }
  return inside(A[0], B) || inside(B[0], A)
}

function checkSheet(s: Sheet, label: string) {
  for (const pl of s.placements) {
    const b = polyBBox(pl.poly)
    if (b.minX < -0.01 || b.minY < -0.01 || b.maxX > s.length + 0.01 || b.maxY > s.width + 0.01) {
      fail(`${label} sheet ${s.index}: ${pl.part.id} runs off the sheet`)
    }
  }
  for (let i = 0; i < s.placements.length; i++) {
    for (let j = i + 1; j < s.placements.length; j++) {
      if (collide(s.placements[i].poly.outer, s.placements[j].poly.outer)) {
        fail(`${label} sheet ${s.index}: ${s.placements[i].part.id} overlaps ${s.placements[j].part.id}`)
      }
    }
  }
}

// ---------------------------------------------------------------- 1. presets

head('Presets: geometry, nesting, no overlaps')
for (const preset of PRESETS) {
  const m = buildModel(sanitize({ ...DEFAULTS, ...preset.patch }))
  const sheets: [string, Sheet[]][] = [
    ['frame', m.frameNest.sheets], ['jig', m.jigNest?.sheets ?? []],
    ['foam', m.foamNest?.sheets ?? []], ['skin', m.skinNest.sheets],
  ]
  for (const [label, list] of sheets) for (const s of list) checkSheet(s, label)
  const rejected = [
    ...m.frameNest.rejected, ...(m.jigNest?.rejected ?? []),
    ...(m.foamNest?.rejected ?? []), ...m.skinNest.rejected,
  ]
  for (const r of rejected) fail(`${preset.id}: ${r.part.id} does not fit the stock (${r.reason})`)
  const yields = sheets.flatMap(([, l]) => l).map((s) => Math.round(sheetYield(s) * 100))
  console.log(
    `  ${preset.id.padEnd(9)} ${String(m.stats.volumeLitres).padStart(6)} L  ` +
    `${m.frame.ribs.length} ribs  ${m.stats.spineCount} spines  ${m.foamParts.length} foam  ` +
    `sheets ${m.stats.frameSheets}f/${m.stats.foamSheets}fo/${m.stats.skinSheets}s  yields ${yields.join('/')}%`,
  )
}

// ---------------------------------------------------------------- 2. joints

head('Half lap joints: every rib meshes with every spine it crosses')
for (const preset of PRESETS) {
  const p = sanitize({ ...DEFAULTS, ...preset.patch })
  const core = buildCore(p)
  const ply = p.plyThickness
  let clash = 0
  let unengaged = 0
  let checked = 0
  for (const rib of core.frame.ribs) {
   const x = rib.station!
   for (const lon of core.frame.longitudinals) {
    // only where the frame says a half lap exists, not merely where the spine
    // happens to run past
    if (!core.frame.slotted.get(Math.abs(lon.y))?.has(core.frame.stations.indexOf(x))) continue
    const st = core.frame.stringers.find(
      (q) => (q.offsetY ?? 0) === lon.y && x > Number(q.meta.from_mm) && x < Number(q.meta.to_mm),
    )
    if (!st) continue
    checked++
    const zLo = core.hull.bottomZ(core.hull.uOf(x))
    const zHi = core.hull.topZ(core.hull.uOf(x))
    let ribOnly = 0, strOnly = 0, both = 0
    for (let iy = 0; iy <= 6; iy++) {
      const y = lon.y - ply / 2 + (ply * iy) / 6
      for (let ix = 0; ix <= 6; ix++) {
        const sx = x - ply / 2 + (ply * ix) / 6
        for (let iz = 0; iz <= 90; iz++) {
          const z = zLo + ((zHi - zLo) * iz) / 90
          const a = inPart({ x: y, y: z }, rib.poly)
          const b = inPart({ x: sx, y: z }, st.poly)
          if (a && b) both++
          else if (a) ribOnly++
          else if (b) strOnly++
        }
      }
    }
    if (both) clash++
    if (!ribOnly || !strOnly) unengaged++
   }
  }
  if (clash) fail(`${preset.id}: ${clash} joint(s) interfere`)
  if (unengaged) fail(`${preset.id}: ${unengaged} joint(s) do not engage`)

  // feet must all reach one plane, or the board will not sit level
  if (core.frame.footBaseZ !== null) {
    const zs = core.frame.ribs.flatMap((r) => (r.poly.outer).map((q) => q.y))
    const lowest = Math.min(...zs)
    if (Math.abs(lowest - core.frame.footBaseZ) > 0.01) {
      fail(`${preset.id}: rib feet reach ${lowest.toFixed(2)} but the bench is at ${core.frame.footBaseZ.toFixed(2)}`)
    }
    const withFeet = core.frame.ribs.filter((r) => r.poly.outer.some((q) => Math.abs(q.y - core.frame.footBaseZ!) < 0.01))
    if (withFeet.length < core.frame.ribs.length) {
      fail(`${preset.id}: only ${withFeet.length} of ${core.frame.ribs.length} ribs reach the bench`)
    }
  }
  console.log(`  ${preset.id.padEnd(9)} ${checked} joints checked, ${clash} clashes, ${unengaged} unengaged` +
    (core.frame.footBaseZ !== null ? `, feet on ${core.frame.ribs.length} ribs` : ', no feet'))
}

head('Sections: nothing tapers away to a knife edge')
for (const preset of PRESETS) {
  const m = buildModel(sanitize({ ...DEFAULTS, ...preset.patch }))
  const p = m.params

  // the rail plank, measured across its developed width
  let plankMin = Infinity
  if (m.plank) {
    for (let i = 0; i < m.plank.flatA.length; i++) {
      plankMin = Math.min(plankMin, Math.hypot(
        m.plank.flatB[i].x - m.plank.flatA[i].x,
        m.plank.flatB[i].y - m.plank.flatA[i].y,
      ))
    }
    const need = Math.max(4, p.outerPlankThickness)
    if (plankMin < need) {
      fail(`${preset.id}: the rail plank narrows to ${plankMin.toFixed(2)} mm, thinner than the ${need.toFixed(2)} mm it is cut from`)
    }
  }

  // every longitudinal panel, measured as the depth of its own outline
  let panelMin = Infinity
  let worst = ''
  for (const part of m.frame.stringers) {
    const from = Number(part.meta.from_mm)
    const to = Number(part.meta.to_mm)
    const y = part.offsetY ?? 0
    for (let i = 0; i <= 60; i++) {
      const x = from + ((to - from) * i) / 60
      const d = panelTopZ(m.hull, x, y) - panelBottomZ(m.hull, x, y)
      if (d < panelMin) { panelMin = d; worst = part.id }
    }
  }
  const panelNeed = p.plyThickness * 2
  if (panelMin < panelNeed) {
    fail(`${preset.id}: ${worst} thins to ${panelMin.toFixed(2)} mm, under twice its own ${p.plyThickness.toFixed(2)} mm thickness`)
  }

  console.log(
    `  ${preset.id.padEnd(9)} plank ${m.plank ? `${plankMin.toFixed(1)} mm narrowest` : 'none'}` +
    `, spines ${panelMin.toFixed(1)} mm shallowest of ${m.frame.stringers.length} pieces`,
  )
}

head('Etching: nothing is cut outside the part it names')
for (const preset of PRESETS) {
  const m = buildModel(sanitize({ ...DEFAULTS, ...preset.patch }))
  const all = [...m.frameParts, ...m.jigParts, ...m.foamParts, ...m.skinParts]
  let checked = 0
  let strayParts = 0
  let noLabel = 0
  for (const part of all) {
    const solid = (pt: V2) =>
      inside(pt, part.poly.outer) && !part.poly.holes.some((h) => inside(pt, h))
    const items = [...(part.marks ?? [])]
    if (part.labelMark) items.push({ ...part.labelMark, text: part.qty > 1 ? `${part.label}a` : part.label })
    else noLabel++
    let stray = false
    for (const mk of items) {
      checked++
      for (const line of strokeText(mk.text, mk.at.x, mk.at.y, mk.size, mk.align ?? 'center', mk.vAlign ?? 'middle')) {
        for (const q of line) if (!solid(q)) { stray = true; break }
        if (stray) break
      }
      if (stray) break
    }
    if (stray) { strayParts++; fail(`${preset.id}: ${part.id} etches text outside its own outline`) }
  }
  console.log(`  ${preset.id.padEnd(9)} ${String(checked).padStart(4)} marks on ${all.length} parts, ${strayParts} stray, ${noLabel} without an anchor`)
}

head('Outer plank: every rib tenon has a mortise to land in')
{
  const m = buildModel(sanitize({ ...DEFAULTS, outerPlank: true }))
  const planks = m.skinParts.filter((q) => q.id.startsWith('plank'))
  if (!planks.length) fail('the outer plank produced no parts')
  const mortises = planks.reduce((a, q) => a + q.poly.holes.length, 0)
  // The plank stops short of both tips, so only the ribs it reaches take part.
  // A rib beyond it must have neither a mortise waiting nor a tenon on it.
  const covered = m.frame.ribs.filter((r) => plankLive(m.hull, r.station!))
  if (mortises < covered.length) {
    fail(`${mortises} mortises for the ${covered.length} ribs the plank reaches`)
  }
  let tenons = 0
  let strayTenons = 0
  for (const rib of m.frame.ribs) {
    const sec = m.hull.section(m.hull.uOf(rib.station!))
    const reach = Math.max(...rib.poly.outer.map((q) => Math.abs(q.x)))
    // a tenon reaches the outer surface; a plain rib stops a skin thickness short
    const hasTenon = reach > sec.halfWidth - m.params.skinThickness + 0.5
    if (!hasTenon) continue
    if (plankLive(m.hull, rib.station!)) tenons++
    else strayTenons++
  }
  if (tenons < covered.length) fail(`only ${tenons} of ${covered.length} covered ribs grew a tenon`)
  if (strayTenons) fail(`${strayTenons} rib(s) grew a tenon past the end of the plank`)
  // and the mortise has to be wide enough for the rib to pass through
  const need = m.params.plyThickness
  for (const q of planks) {
    for (const h of q.poly.holes) {
      // the first edge runs along the plank: that is the one the rib passes
      // through. The other is the tenon's height, which tapers by design.
      const w = Math.hypot(h[1].x - h[0].x, h[1].y - h[0].y)
      if (w < need - 0.01) { fail(`${q.id}: a mortise is ${w.toFixed(2)} mm across, the rib is ${need} mm`); break }
    }
  }
  console.log(`  ${planks.length} plank section(s), ${mortises} mortises, ${tenons}/${m.frame.ribs.length} ribs tenoned (${m.frame.ribs.length - covered.length} beyond its ends)`)

  const off = buildModel(sanitize({ ...DEFAULTS, outerPlank: false }))
  if (off.skinParts.some((q) => q.id.startsWith('plank'))) fail('the plank is still cut when it is switched off')
  console.log(`  switched off: ${off.skinParts.length} skin parts, no plank`)
}

head('Connections: every part is held by another, nothing floats')
for (const preset of PRESETS) {
  const m = buildModel(sanitize({ ...DEFAULTS, ...preset.patch }))
  const f = m.frame
  const sets = [...f.slotted.values()]

  // a rib with no half lap anywhere along it is a loose piece of plywood
  const orphans = f.ribs.filter((_, i) => !sets.some((set) => set.has(i)))
  if (orphans.length) {
    fail(`${preset.id}: ${orphans.length} rib(s) have no joint at all: ${orphans.map((r) => r.id).join(', ')}`)
  }

  // and a spine has to stop near its outermost joint, not run on past it
  let worstOverhang = 0
  for (const lon of f.longitudinals) {
    const idx = [...(f.slotted.get(Math.abs(lon.y)) ?? [])].sort((a, b) => a - b)
    if (idx.length < 2) { fail(`${preset.id}: the spine at y=${lon.y.toFixed(0)} has ${idx.length} joint(s)`); continue }
    const first = f.stations[idx[0]]
    const last = f.stations[idx[idx.length - 1]]
    worstOverhang = Math.max(worstOverhang, first - lon.x0, lon.x1 - last)
  }
  const allowed = Math.max(m.params.plyThickness * 2, m.params.length * 0.004) * 1.6
  if (worstOverhang > allowed) {
    fail(`${preset.id}: a spine runs ${worstOverhang.toFixed(0)} mm past its last joint, more than the ${allowed.toFixed(0)} mm shoulder`)
  }

  // every rib slot must have a spine to receive it, and the other way round
  let ribSlots = 0
  for (const rib of f.ribs) ribSlots += Number(rib.meta.slots)
  // a spine off the centreline is one entry in the map but two slots in a rib
  let spineSlots = 0
  for (const [y, set] of f.slotted) spineSlots += set.size * (y === 0 ? 1 : 2)
  if (ribSlots !== spineSlots) {
    fail(`${preset.id}: ${ribSlots} slots cut in ribs against ${spineSlots} in the spines, so some do not pair up`)
  }

  // the rail plank is held by the tenons through its mortises, so it must not
  // run on past the last of them either
  let plankOver = 0
  if (m.plank && m.plank.stationsAlong.length) {
    // in board coordinates: the developed strip runs longer than the board
    // does wherever the rail curves in plan, which is exactly at the tips
    const sa = m.plank.stationsAlong
    const [lo, hi] = m.plank.spanX
    plankOver = Math.max(sa[0].x - lo, hi - sa[sa.length - 1].x)
    if (plankOver > allowed) {
      fail(`${preset.id}: the rail plank runs ${plankOver.toFixed(0)} mm past its last mortise, more than the ${allowed.toFixed(0)} mm shoulder`)
    }
  }

  console.log(
    `  ${preset.id.padEnd(9)} ${f.ribs.length} ribs, all jointed; ${ribSlots} half laps, paired; ` +
    `worst overhang ${Math.max(worstOverhang, plankOver).toFixed(1)} mm of ${allowed.toFixed(0)} allowed`,
  )
}

head('Ends: ribs carry the planking past where the plank stops')
for (const preset of PRESETS) {
  const m = buildModel(sanitize({ ...DEFAULTS, ...preset.patch }))
  const limits = plankLimits(m.hull)
  const stations = m.frame.stations
  const first = stations[0]
  const last = stations[stations.length - 1]

  if (m.params.endRibs) {
    // a rib has to sit at, or within one spacing of, each tip
    const gap = m.params.endRibSpacing * 1.5
    if (first > gap) fail(`${preset.id}: the first rib is ${first.toFixed(0)} mm in, leaving the tail unsupported`)
    if (m.params.length - last > gap) {
      fail(`${preset.id}: the last rib is ${(m.params.length - last).toFixed(0)} mm from the nose, leaving it unsupported`)
    }
    // and nowhere along the board should the gap between ribs exceed the main spacing
    let widest = 0
    for (let i = 1; i < stations.length; i++) widest = Math.max(widest, stations[i] - stations[i - 1])
    if (widest > m.stats.ribSpacingMax + 0.5) {
      fail(`${preset.id}: a ${widest.toFixed(0)} mm gap between ribs, wider than the ${m.stats.ribSpacingMax} mm main spacing`)
    }
  }

  // every part in the bundle has to be a flat cut part: nothing carved, nothing laminated
  for (const part of [...m.frameParts, ...m.jigParts, ...m.foamParts, ...m.skinParts]) {
    if (!part.poly.outer.length) fail(`${preset.id}: ${part.id} has no outline to cut`)
  }

  console.log(
    `  ${preset.id.padEnd(9)} ${stations.length} ribs total, ${m.frame.endRibCount.tail} closing the tail and ` +
    `${m.frame.endRibCount.nose} the nose, first at ${first.toFixed(0)} mm, last ${(m.params.length - last).toFixed(0)} mm from the tip` +
    `${limits ? `, plank ${limits[0].toFixed(0)}..${limits[1].toFixed(0)}` : ', no plank'}`,
  )
}

head('Spine layouts: an even count must leave the centreline clear')
for (const spines of [1, 2, 3, 4, 5, 6]) {
  const m = buildModel(sanitize({ ...DEFAULTS, spines }))
  const ys = m.frame.longitudinals.map((l) => l.y)
  const onCentre = ys.some((y) => Math.abs(y) < 1e-6)
  if (spines % 2 === 1 && !onCentre) fail(`spines=${spines}: odd count has nothing on the centreline`)
  if (spines % 2 === 0 && onCentre) fail(`spines=${spines}: even count still has a panel on the centreline`)
  const middleBlocks = m.foamParts.filter((q) => String(q.meta.compartment) === 'm').length
  if (spines % 2 === 0 && m.params.foamInserts && !middleBlocks) {
    fail(`spines=${spines}: the open middle produced no foam block`)
  }
  console.log(`  spines=${spines}  offsets ${ys.map((y) => y.toFixed(0)).join(',')}  ` +
    `panels ${m.frame.stringers.length}  foam ${m.foamParts.length}${middleBlocks ? ` (${middleBlocks} spanning the middle)` : ''}`)
}

head('Outlines: an inward offset must not fold back on itself')
for (const railFlat of [0, 0.15, 0.4, 0.7]) {
  const core = buildCore(sanitize({ ...DEFAULTS, railFlat }))
  // Test the plain inset section, not the finished rib: slots, feet and rail
  // rebates all reverse direction on purpose, so they would mask the artifact.
  let folds = 0
  // right out to the tips: that is where the section is thinnest and where the
  // rail band now has to stay usable for the plank to reach
  for (let i = 0; i < 21; i++) {
    const u = 0.01 + (0.98 * i) / 20
    const o = ensureCCW(offsetPolygon(core.hull.sectionOutline(u, 48), -core.params.skinThickness))
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length], c = o[(i + 2) % o.length]
      const d1 = { x: b.x - a.x, y: b.y - a.y }
      const d2 = { x: c.x - b.x, y: c.y - b.y }
      const l1 = Math.hypot(d1.x, d1.y)
      const l2 = Math.hypot(d2.x, d2.y)
      // Only count a reversal long enough to see or cut. Sub tenth of a
      // millimetre wobble is arithmetic, not a lip.
      if (l1 < 0.5 || l2 < 0.5) continue
      if (d1.x * d2.x + d1.y * d2.y < 0) folds++
    }
  }
  if (folds > 0) fail(`railFlat=${railFlat}: the inset outline folds back at ${folds} corner(s)`)
  console.log(`  railFlat=${String(railFlat).padEnd(4)} ${folds} folds across 21 stations`)
}

// ---------------------------------------------------------------- 3. files

head('Exported files')
{
  const m = buildModel()
  const stl = (name: string, mesh: Float32Array) => {
    const blob = meshToStl(mesh, name)
    return blob.arrayBuffer().then((ab) => {
      const dv = new DataView(ab)
      const tris = dv.getUint32(80, true)
      if (ab.byteLength !== 84 + tris * 50) fail(`${name}: STL length does not match its triangle count`)
      for (let i = 0; i < tris; i++) {
        for (let k = 0; k < 12; k++) {
          if (!Number.isFinite(dv.getFloat32(84 + i * 50 + k * 4, true))) { fail(`${name}: STL has a non finite coordinate`); return }
        }
      }
      console.log(`  ${name.padEnd(20)} ${String(tris).padStart(6)} triangles, ${(ab.byteLength / 1024).toFixed(0)} KB`)
    })
  }
  await stl('frame_assembled', assembledFrameMesh(m))
  await stl('hull_shape', hullMesh(m.hull))
  await stl('rib-08', flatPartMesh(m.frameParts.find((p) => p.id === 'rib-08')!))

  const svg = sheetToSvg(m.frameNest.sheets[0], 'test')
  if (!svg.includes('<svg') || !svg.includes('id="cut"')) fail('SVG is missing its cut layer')
  if (!/viewBox="0 0 \d/.test(svg)) fail('SVG has no viewBox')
  const dxf = sheetToDxf(m.frameNest.sheets[0])
  const codes = dxf.split('\r\n')
  if (codes.length % 2 !== 1) fail('DXF is not a clean sequence of code/value pairs')
  const count = (t: string) => codes.filter((l) => l === t).length
  if (count('SECTION') !== count('ENDSEC')) fail('DXF sections are unbalanced')
  if (count('POLYLINE') !== count('SEQEND')) fail('DXF polylines are unbalanced')
  if (!dxf.endsWith('EOF\r\n')) fail('DXF does not end with EOF')
  console.log(`  frame_sheet_01.svg   ${(svg.length / 1024).toFixed(0)} KB`)
  if (count('TEXT') > 0) fail('DXF still emits font based TEXT, which not every controller can engrave')
  console.log(`  frame_sheet_01.dxf   ${(dxf.length / 1024).toFixed(0)} KB, ${count('POLYLINE')} polylines including stroked text`)

  const { blob, name, fileCount } = await buildBundle(m)
  if (fileCount < 20) fail(`bundle only has ${fileCount} files`)
  console.log(`  ${name.padEnd(20)} ${fileCount} files, ${(blob.size / 1048576).toFixed(2)} MB`)
}

// ---------------------------------------------------------------- 4. fuzz

head('Fuzz: random parameter combinations across the full slider ranges')
{
  const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
  const ranges = GROUPS.flatMap((g) => g.fields).filter((f) => f.kind === 'range')
  const toggles = GROUPS.flatMap((g) => g.fields).filter((f) => f.kind === 'toggle')
  const N = Number(process.env.N || 120)
  let worst = 0
  let total = 0
  let bad = 0

  for (let seed = 1; seed <= N; seed++) {
    const r = rng(seed * 7919)
    const p: Params = { ...DEFAULTS }
    for (const f of ranges) {
      // lean on the extremes, which is where geometry gives up
      const t = r() < 0.35 ? (r() < 0.5 ? 0 : 1) : r()
      ;(p as unknown as Record<string, number>)[f.key] = Math.round((f.min + (f.max - f.min) * t) / f.step) * f.step
    }
    for (const f of toggles) (p as unknown as Record<string, boolean>)[f.key] = r() < 0.5

    const t0 = Date.now()
    try {
      const m = buildModel(sanitize(p))
      for (const part of [...m.frameParts, ...m.jigParts, ...m.skinParts]) {
        const a = Math.abs(signedArea(part.poly.outer))
        if (!Number.isFinite(a) || a <= 0) throw new Error(`${part.id} has no area`)
        if (part.poly.outer.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) throw new Error(`${part.id} has a non finite vertex`)
        let ha = 0
        for (const h of part.poly.holes) ha += Math.abs(signedArea(h))
        if (ha > a) throw new Error(`${part.id} holes are bigger than the part`)
        const mesh = extrudePoly(part.poly, part.thickness)
        if (!mesh.length) throw new Error(`${part.id} produced an empty mesh`)
        if (mesh.some((v) => !Number.isFinite(v))) throw new Error(`${part.id} mesh has a non finite coordinate`)
      }
      for (const s of [...m.frameNest.sheets, ...(m.jigNest?.sheets ?? []), ...m.skinNest.sheets]) {
        for (const pl of s.placements) {
          const b = polyBBox(pl.poly)
          if (b.maxX > s.length + 0.01 || b.maxY > s.width + 0.01 || b.minX < -0.01 || b.minY < -0.01) {
            throw new Error(`${pl.part.id} runs off sheet ${s.index}`)
          }
        }
      }
      for (const k of ['volumeLitres', 'estWeightLoKg', 'maxSectionArea'] as const) {
        if (!Number.isFinite(m.stats[k]) || m.stats[k] < 0) throw new Error(`stat ${k} came out as ${m.stats[k]}`)
      }
    } catch (e) {
      bad++
      if (bad <= 5) fail(`seed ${seed}: ${(e as Error).message}`)
    }
    const ms = Date.now() - t0
    total += ms
    worst = Math.max(worst, ms)
  }
  console.log(`  ${N - bad}/${N} random boards built cleanly`)
  console.log(`  build time: mean ${(total / N).toFixed(0)} ms, worst ${worst} ms`)
  // Wall clock on a shared machine is noisy, so this is advice, not a verdict.
  // Only a build slow enough to mean an algorithmic regression fails the suite.
  if (worst > 1500) console.log(`  NOTE worst case is over 1.5 s, which will feel sluggish while dragging a slider`)
  if (worst > 8000) fail(`worst case build of ${worst} ms suggests something has gone quadratic`)
}

// ----------------------------------------------------------------

console.log(`\n${failures === 0 ? 'PASS: all checks green' : `FAIL: ${failures} problem(s)`}`)
process.exit(failures ? 1 : 0)
