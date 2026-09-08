import { DEFAULTS, Params, sanitize } from './params'
import { Hull } from './geom/hull'
import { buildFrame, fitMarks, Frame, Part, frameBottomZ, frameTopZ, slotMidZ } from './geom/frame'
import { buildFoamBlocks } from './geom/foam'
import { developPlank, developStrips, plankParts, stripParts, StripDev } from './geom/skin'
import { nest, NestResult } from './export/nest'
import { V2, circlePts, signedArea, v2 } from './geom/vec'
import { fmtLen } from './units'

export interface Stats {
  volumeLitres: number
  wettedLength: number
  maxSectionArea: number
  frameAreaM2: number
  skinAreaM2: number
  frameSheets: number
  jigSheets: number
  skinSheets: number
  foamSheets: number
  endRibCount: number
  foamLitres: number
  spineCount: number
  railStripLength: number
  datumZ: number | null
  estWeightLoKg: number
  estWeightHiKg: number
  ribSpacingMin: number
  ribSpacingMax: number
  mainRibSpacing: number
}

/** The fast half: shape and skeleton only. Cheap enough to rebuild while a slider moves. */
export interface CoreModel {
  params: Params
  hull: Hull
  frame: Frame
  frameParts: Part[]
  jigParts: Part[]
  foamParts: Part[]
  datumZ: number | null
}

export interface BoardModel extends CoreModel {
  strips: StripDev[]
  plank: StripDev | null
  skinParts: Part[]
  frameNest: NestResult
  jigNest: NestResult | null
  skinNest: NestResult
  foamNest: NestResult | null
  stats: Stats
}

export function polyArea(p: { outer: V2[]; holes: V2[][] }): number {
  let a = Math.abs(signedArea(p.outer))
  for (const h of p.holes) a -= Math.abs(signedArea(h))
  return Math.max(0, a)
}

/**
 * A single height that lies inside every rib. Engraved on each rib and along
 * the stringer it becomes the setup line: clamp every rib so its datum mark
 * sits at one height above the strongback and the frame is aligned.
 */
function findDatum(h: Hull, stations: number[]): number | null {
  let lo = -Infinity
  let hi = Infinity
  for (const x of stations) {
    lo = Math.max(lo, frameBottomZ(h, x))
    hi = Math.min(hi, frameTopZ(h, x))
  }
  const pad = (hi - lo) * 0.15
  if (hi - lo < 6) return null
  return (lo + pad + (hi - pad)) / 2
}

/** Score marks that make the frame straightforward to set up and glue. */
function addFrameEngraving(h: Hull, frame: Frame, datumZ: number | null) {
  const p = h.p
  const slotHalf = (p.plyThickness + p.slotClearance) / 2
  // Feet already set every rib height off one flat bench, so the datum line
  // would only be clutter. The ribs keep their foot cut lines either way.
  if (datumZ === null || frame.footBaseZ !== null) return

  for (const rib of frame.ribs) {
    const x = rib.station!
    const sec = h.section(h.uOf(x))
    const reach = Math.max(0, sec.halfWidth * 0.62)
    const lines: V2[][] = []
    if (reach > slotHalf + 4) {
      lines.push([v2(-reach, datumZ), v2(-slotHalf - 2, datumZ)])
      lines.push([v2(slotHalf + 2, datumZ), v2(reach, datumZ)])
    }
    // a short tick on the keel so the rib can be centred on the stringer
    lines.push([v2(0, frameBottomZ(h, x)), v2(0, frameBottomZ(h, x) + Math.min(12, slotHalf * 3))])
    rib.engrave = [...(rib.engrave ?? []), ...lines]
  }

  for (const st of frame.stringers) {
    if (st.offsetY) continue // side panels are short on room, leave them clean
    const from = Number(st.meta.from_mm)
    const to = Number(st.meta.to_mm)
    const lines: V2[][] = []
    const blocked = frame.stations
      .filter((s) => s > from && s < to && slotMidZ(h, s) > datumZ)
      .map((s) => [s - slotHalf - 2, s + slotHalf + 2] as const)
      .sort((a, b) => a[0] - b[0])
    let cur = from + 4
    for (const [a, b] of blocked) {
      if (a > cur) lines.push([v2(cur, datumZ), v2(a, datumZ)])
      cur = Math.max(cur, b)
    }
    if (to - 4 > cur) lines.push([v2(cur, datumZ), v2(to - 4, datumZ)])
    // station ticks under each slot
    for (const s of frame.stations) {
      if (s <= from || s >= to) continue
      const z = frameBottomZ(h, s)
      lines.push([v2(s, z), v2(s, z + Math.min(14, (frameTopZ(h, s) - z) * 0.25))])
    }
    st.engrave = [...(st.engrave ?? []), ...lines]
  }
}

/** Mark a Gore vent plug on the deck centre strip, back near the tail. */
function addVentMark(p: Params, skinParts: Part[]) {
  if (!p.ventHole) return
  // the deck centre strip is the last skin part that is not the rail plank
  const candidates = skinParts.filter((s) => s.id.startsWith('skin-'))
  if (!candidates.length) return
  const last = candidates[candidates.length - 1].id.replace(/-\d+$/, '')
  const first = candidates.find((s) => s.id.startsWith(last))!
  const xs = first.poly.outer.map((q) => q.x)
  const ys = first.poly.outer.map((q) => q.y)
  const cx = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.18
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const r = Math.max(3, Math.min(9, p.length * 0.004))
  first.engrave = [...(first.engrave ?? []), circlePts(cx, cy, r, 32).concat([v2(cx + r, cy)])]
  first.meta.vent_plug = `${Math.round(r * 2)} mm hole, drill after glue up`
}

export function buildCore(input: Partial<Params> = {}): CoreModel {
  const params = sanitize({ ...DEFAULTS, ...input })
  const hull = new Hull(params)
  const frame = buildFrame(hull)
  const datumZ = findDatum(hull, frame.stations)
  addFrameEngraving(hull, frame, datumZ)
  return {
    params,
    hull,
    frame,
    frameParts: [...frame.stringers, ...frame.ribs],
    jigParts: frame.jigs,
    foamParts: buildFoamBlocks(hull, frame),
    datumZ,
  }
}

export function buildModel(input: Partial<Params> | CoreModel = {}): BoardModel {
  const core = 'hull' in input ? (input as CoreModel) : buildCore(input as Partial<Params>)
  const { params, hull, frame, frameParts, jigParts, foamParts, datumZ } = core

  const strips = developStrips(hull, frame.stations)
  const plank = developPlank(hull, frame.stations)
  const skinParts = [...stripParts(hull, strips), ...plankParts(hull, plank)]
  addVentMark(params, skinParts)
  // nothing gets etched outside the part it names
  for (const part of [...skinParts, ...foamParts]) fitMarks(part)

  const stock = (thick: number, what: string) => `${fmtLen(thick, params.units)} ${what}`
  const frameNest = nest(frameParts, params, stock(params.plyThickness, 'plywood'))
  // the cradle is scrap work: it does not need marine ply and it is not part of the board
  const jigNest = jigParts.length ? nest(jigParts, params, stock(params.plyThickness, 'jig stock')) : null
  const skinNest = nest(skinParts, params, stock(params.skinThickness, 'skin stock'))
  const foamNest = foamParts.length ? nest(foamParts, params, stock(params.foamThickness, 'foam')) : null

  const frameAreaMm2 = frameParts.reduce((a, p) => a + polyArea(p.poly) * p.qty, 0)
  const skinAreaMm2 = skinParts.reduce((a, p) => a + polyArea(p.poly) * p.qty, 0)
  const frameVolM3 = (frameAreaMm2 * params.plyThickness) / 1e9
  const skinVolM3 = (skinAreaMm2 * params.skinThickness) / 1e9
  // 400 to 550 kg/m3 covers okoume through paulownia and light cedar, then
  // roughly half as much again for glass, epoxy and fittings
  const woodLo = (frameVolM3 + skinVolM3) * 400
  const woodHi = (frameVolM3 + skinVolM3) * 550

  const gaps: number[] = []
  for (let i = 1; i < frame.stations.length; i++) gaps.push(frame.stations[i] - frame.stations[i - 1])

  let maxA = 0
  for (let i = 0; i <= 100; i++) maxA = Math.max(maxA, hull.sectionArea(i / 100))

  const stats: Stats = {
    volumeLitres: round(hull.volumeLitres(), 1),
    wettedLength: round(hull.rockerLineLength(), 1),
    maxSectionArea: round(maxA / 100, 1), // cm^2
    frameAreaM2: round(frameAreaMm2 / 1e6, 3),
    skinAreaM2: round(skinAreaMm2 / 1e6, 3),
    frameSheets: frameNest.sheets.length,
    jigSheets: jigNest?.sheets.length ?? 0,
    skinSheets: skinNest.sheets.length,
    foamSheets: foamNest?.sheets.length ?? 0,
    endRibCount: frame.endRibCount.tail + frame.endRibCount.nose,
    foamLitres: round(foamParts.reduce((a, q) => a + polyArea(q.poly) * q.thickness * q.qty, 0) / 1e6, 1),
    // physical panels, not distinct offsets: everything off the centreline is a pair
    spineCount: frame.longitudinals.reduce((a, l) => a + (l.y === 0 ? 1 : 2), 0),
    railStripLength: round(railLength(hull), 1),
    datumZ: datumZ === null ? null : round(datumZ, 1),
    estWeightLoKg: round(woodLo * 1.35, 1),
    estWeightHiKg: round(woodHi * 1.55, 1),
    ribSpacingMin: round(Math.min(...gaps), 1),
    ribSpacingMax: round(Math.max(...gaps), 1),
    mainRibSpacing: round(frame.mainSpacing, 1),
  }

  return { ...core, strips, plank, skinParts, frameNest, jigNest, skinNest, foamNest, stats }
}

/** Arc length of the plan outline down one side, for the rail strips. */
function railLength(h: Hull, steps = 400): number {
  let l = 0
  let px = 0
  let py = h.halfWidth(0)
  for (let i = 1; i <= steps; i++) {
    const u = i / steps
    const x = h.xOf(u)
    const y = h.halfWidth(u)
    l += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return l
}

export const round = (v: number, d = 1) => {
  const m = Math.pow(10, d)
  return Math.round(v * m) / m
}

export const mmToIn = (mm: number) => mm / 25.4
export function mmToFtIn(mm: number): string {
  const totalIn = mm / 25.4
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn - ft * 12
  return `${ft}'${(Math.round(inch * 4) / 4).toFixed(2).replace(/\.?0+$/, '')}"`
}
