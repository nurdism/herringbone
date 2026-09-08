import type { BoardModel } from '../model'
import { mmToIn, polyArea, round } from '../model'
import { frameBottomZ, frameTopZ, slotMidZ } from '../geom/frame'
import { sheetYield } from './nest'
import { fmtArea, fmtLen, fmtMass, fmtVolume } from '../units'
import { minPlankBand } from '../params'

const n1 = (v: number) => round(v, 1).toFixed(1)
const n2 = (v: number) => round(v, 2).toFixed(2)

/** The classic table of offsets, one row per rib station. */
export function offsetsCsv(m: BoardModel): string {
  const h = m.hull
  const rows = ['station,x_mm,x_in,half_width_mm,thickness_mm,rocker_mm,frame_bottom_z_mm,frame_top_z_mm,slot_mid_z_mm,frame_depth_mm']
  m.frame.stations.forEach((x, i) => {
    const u = h.uOf(x)
    rows.push([
      `R${i + 1}`,
      n1(x),
      n2(mmToIn(x)),
      n1(h.halfWidth(u)),
      n1(h.thicknessAt(u)),
      n1(h.bottomZ(u)),
      n1(frameBottomZ(h, x)),
      n1(frameTopZ(h, x)),
      n1(slotMidZ(h, x)),
      n1(frameTopZ(h, x) - frameBottomZ(h, x)),
    ].join(','))
  })
  return rows.join('\n') + '\n'
}

/** A finer table for lofting the shape by hand or checking a CAD import. */
export function linesCsv(m: BoardModel, steps = 40): string {
  const h = m.hull
  const rows = ['pct,x_mm,half_width_mm,rocker_bottom_mm,deck_top_mm,thickness_mm,section_area_cm2']
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    rows.push([
      n1(u * 100),
      n1(h.xOf(u)),
      n1(h.halfWidth(u)),
      n1(h.bottomZ(u)),
      n1(h.topZ(u)),
      n1(h.thicknessAt(u)),
      n1(h.sectionArea(u) / 100),
    ].join(','))
  }
  return rows.join('\n') + '\n'
}

export function cutlistCsv(m: BoardModel): string {
  const rows = ['part_id,label,kind,qty,material,thickness_mm,bbox_w_mm,bbox_h_mm,area_cm2,notes']
  const all = [...m.frameParts, ...m.jigParts, ...m.foamParts, ...m.skinParts]
  for (const p of all) {
    const xs = p.poly.outer.map((q) => q.x)
    const ys = p.poly.outer.map((q) => q.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const hh = Math.max(...ys) - Math.min(...ys)
    const U = m.params.units
    const material =
      p.kind === 'skin' ? `${fmtLen(m.params.skinThickness, U)} skin stock`
      : p.kind === 'jig' ? `${fmtLen(m.params.plyThickness, U)} jig stock`
      : p.kind === 'foam' ? `${fmtLen(m.params.foamThickness, U)} foam`
      : `${fmtLen(m.params.plyThickness, U)} plywood`
    const notes = Object.entries(p.meta)
      .filter(([k]) => k !== 'of')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    rows.push([p.id, p.label, p.kind, p.qty, material, p.thickness, n1(w), n1(hh), n1(polyArea(p.poly) / 100), `"${notes}"`].join(','))
  }
  return rows.join('\n') + '\n'
}

export function buildDoc(m: BoardModel): string {
  const p = m.params
  const s = m.stats
  const h = m.hull
  const U = p.units
  const len = (v: number, feet?: boolean) => fmtLen(v, U, feet === undefined ? {} : { feet })
  const L = m.frameNest
  const K = m.skinNest

  const stationTable = m.frame.stations
    .map((x, i) => {
      const u = h.uOf(x)
      return `| R${i + 1} | ${n1(x)} | ${n2(mmToIn(x))} | ${n1(h.halfWidth(u) * 2)} | ${n1(frameTopZ(h, x) - frameBottomZ(h, x))} | ${n1(slotMidZ(h, x))} |`
    })
    .join('\n')

  const stripTable = m.strips
    .map(
      (d) =>
        `| ${d.index + 1} | ${n1(d.meta.edge_length_mm)} | ${n1(d.meta.min_width_mm)} | ${n1(d.meta.max_width_mm)} | ${n1(d.meta.bevel_inner_deg)} | ${n1(d.meta.bevel_outer_deg)} |`,
    )
    .join('\n')

  const J = m.jigNest
  const F = m.foamNest
  const sheetTable = [...L.sheets, ...(J?.sheets ?? []), ...(F?.sheets ?? []), ...K.sheets]
    .map((sh, i) => `| ${i + 1} | ${sh.material} | ${sh.length} x ${sh.width} | ${sh.placements.length} | ${Math.round(sheetYield(sh) * 100)}% |`)
    .join('\n')

  const rejected = [...L.rejected, ...(J?.rejected ?? []), ...(F?.rejected ?? []), ...K.rejected]
  const rejectedBlock = rejected.length
    ? `\n> **${rejected.length} part(s) did not fit the sheet.** Raise the sheet size, or lower the rib count / raise the strip count so the pieces come out smaller.\n>\n` +
      rejected.map((r) => `> - \`${r.part.id}\` ${r.reason}`).join('\n') +
      '\n'
    : ''

  const splices = m.frame.stringers.length > 1
    ? `The stringer is ${m.frame.stringers.length} pieces spliced with ${p.fingerJointTeeth} finger joints, ${p.fingerJointDepth} mm deep. Splices land midway between ribs so no slot sits on a joint. Glue the splices first, on a flat surface, and let them cure before slotting the ribs on.`
    : 'The stringer comes out of a single sheet, no splice needed.'

  return `# ${p.name}

A hollow fishbone frame stand up paddleboard, generated parametrically.
Every file in this bundle is at 1:1 in millimetres.

## The board

| | |
|---|---|
| Length | ${len(p.length, true)} |
| Width | ${len(p.width, false)} |
| Thickness | ${len(p.thickness, false)} |
| Volume | **${fmtVolume(s.volumeLitres, U)}** |
| Nose rocker | ${len(p.noseRocker, false)} |
| Tail rocker | ${len(p.tailRocker, false)} |
| Wide point | ${Math.round(p.widePoint * 100)}% from the tail |
| Flat rail band | ${p.railFlat > 0 ? len(p.thickness * p.railFlat, false) : 'none, the deck and hull meet at a corner'} |
| Rocker line length | ${len(s.wettedLength, true)} |
| Estimated finished weight | ${fmtMass(s.estWeightLoKg, U)} to ${fmtMass(s.estWeightHiKg, U)} |

Rider guidance from volume alone: a board floats a paddler comfortably at
roughly 1.3 to 2.0 times their body weight in litres for all round use, and
1.0 to 1.4 for surf. At ${n1(s.volumeLitres)} L this suits roughly
${Math.round(s.volumeLitres / 2.0)} to ${Math.round(s.volumeLitres / 1.3)} kg
of rider plus kit for all round paddling.

## Materials

| | |
|---|---|
| Frame | ${len(p.plyThickness, false)} plywood, ${fmtArea(s.frameAreaM2 * 1e6, U)} of parts, **${s.frameSheets} sheet(s)** at ${len(p.sheetLength, true)} x ${len(p.sheetWidth, true)} |
| Skin | ${len(p.skinThickness, false)} stock, ${fmtArea(s.skinAreaM2 * 1e6, U)} of parts, **${s.skinSheets} sheet(s)** |
| Foam | ${s.foamSheets ? `${len(p.foamThickness, false)} sheet, **${s.foamSheets} sheet(s)**, about ${s.foamLitres} L of blocks` : 'no foam inserts'} |
| End ribs | ${s.endRibCount ? `${s.endRibCount} extra ribs at ${len(p.endRibSpacing, false)} spacing, pinning the plank ends at the tips` : 'not used'} |
| Outer rail plank | ${p.outerPlank ? `${len(p.outerPlankThickness, false)} stock, mortised at every rib. Ribs carry a ${len(p.ribTenonHeight, false)} tenon into it.` : 'not used'} |
| Rail strips | ${p.railStrip ? `2 off, ${len(s.railStripLength, true)} long x ${len(p.railStripHeight, false)} x ${len(p.railStripThickness, false)}. Rip from a board, or laminate from thin strips: they bend around the plan curve.` : 'not used'} |
| Setup jig | ${s.jigSheets ? `${len(p.plyThickness, false)} scrap sheet, **${s.jigSheets} sheet(s)**. Any cheap ply, it is not part of the board.` : 'not generated'} |
| Ribs | ${m.frame.ribs.length} in all: ${p.ribCount} main ribs at ${len(s.mainRibSpacing, false)}${s.endRibCount ? `, plus ${s.endRibCount} closing the tips at ${len(p.endRibSpacing, false)}` : ''} |
| Spines | ${s.spineCount} vertical panel${s.spineCount > 1 ? 's' : ''}${m.frame.longitudinals[0]?.y ? ', none on the centreline, so the middle of the board stays open' : ', one on the centreline'}${m.frame.longitudinals.length > 1 ? `, outermost pair ${len(m.frame.longitudinals[m.frame.longitudinals.length - 1].y, false)} off centre` : ''} |
| Slot width | ${len(m.frame.slotWidth, false)} (${len(p.plyThickness, false)} material plus ${n2(p.slotClearance)} mm fit) |
| Kerf allowance | ${n2(p.kerf)} mm, already added to every cut path |

Use marine or aircraft grade plywood for the frame: okoume, poplar or
paulownia. The skin can be the same plywood, or cedar strip if you would
rather bead and cove it. Everything gets sheathed in glass and epoxy once it
is closed up, and that sheathing is what actually makes the board stiff.

${rejectedBlock}
## Cutting

${sheetTable ? `| Sheet | Material | Size mm | Parts | Yield |\n|---|---|---|---|---|\n${sheetTable}` : 'No sheets generated.'}

Files are in \`2d/svg\` and \`2d/dxf\`, one file per sheet.

- **cut** layer, black: every outline and cutout.
- **engrave** layer, blue: part names, joint numbers, foot cut lines and
  station ticks. All of it is single stroke text and polylines, so it scribes
  in one pass without needing a font.
- **guide** layer, grey dashed: the sheet edge. Do not cut it.

Cut paths already include half of the ${p.kerf} mm kerf, so tell your
machine to follow the line rather than offsetting again.

## The frame

${splices}

### Setting the rocker

${
  m.frame.footBaseZ !== null
    ? `Every rib carries **two sacrificial feet** reaching down to one common plane, ` +
      `${len(p.footHeight, false)} below the lowest point of the frame. Stand the assembled skeleton on a flat bench and the rocker is set: ` +
      `a rib near the nose has taller feet than one amidships, and that difference is the rocker. ` +
      `An engraved line across each foot marks where to cut it off, with a small nick at each side to start the saw. ` +
      `Plank the deck first, then cut the feet off, turn the board over and plank the hull.\n\n` +
      `Because the board stands hull down while you work on it, the half laps run the other way from the usual: ` +
      `**ribs are slotted from the deck, spines from the hull**, so the spines rest on the ribs rather than hanging out of them.`
    : s.datumZ === null
      ? 'The sections vary too much for a single datum line, so set the ribs off the spines alone, or turn on rib feet.'
      : `Every rib and spine carries an engraved **datum line at ${len(s.datumZ, false)} above the board baseline**. Build a flat strongback and shim each rib until its datum mark sits at one constant height. Get that right and the rocker takes care of itself, because it is already built into the spines.`
}

${
  m.jigParts.length
    ? `### The rocker cradle

` +
      `${m.jigParts.length} cradle panel${m.jigParts.length > 1 ? 's, each cut twice' : ', cut twice'}, ` +
      `standing ${p.jigDepth} mm below the lowest point of the frame. Screw one pair to a flat bench either side of the centreline, ` +
      `${p.plyThickness * 2} to ${p.plyThickness * 3} mm apart, and drop the stringer into the slot between them. The top edge follows the ` +
      `stringer's underside with ${p.jigClearance} mm of clearance, so glue squeeze out will not bond the board to its own jig. ` +
      `Ticks on the cradle mark every rib station. Cut these from scrap: they are thrown away when the board is closed.\n`
    : `No cradle is generated. Turn on **Rocker cradle** if you would rather not hold the rocker by hand while the glue goes off.`
}

${m.frame.ribSlotFromTop
  ? 'Ribs slot **down from the deck**, the spines slot **up from the hull**.'
  : 'Ribs slot **up from the hull**, the spines slot **down from the deck**.'}
They meet half way, which is the \`slot_mid_z\` column in \`offsets.csv\`.
Dry fit the whole skeleton before any glue touches it.

${p.numberJoints
  ? `Every half lap is **numbered on both halves**. Match the number on the rib to the number beside the slot on the spine and the frame can only go together one way. Spines off the centreline are cut in pairs and both copies carry the same numbers, because the two sides are interchangeable.`
  : `Joint numbering is switched off. Work from the station table below instead.`}

${p.outerPlank
  ? `### The outer rail plank\n\n` +
    `Both rails of every rib are set back ${len(p.outerPlankThickness - p.skinThickness, false)} to seat the plank, and a ` +
    `${len(p.ribTenonHeight, false)} **tenon** grows back out through it, reaching the outer surface to be trimmed flush once the glue is off. ` +
    `The plank carries a matching **mortise** at every station, so it drops over the rib ends and holds the plan outline itself rather than you having to. ` +
    `Fit both rail planks before any other planking: they are what makes the frame rigid enough to plank against.\n\n` +
    `The plank is cut flat, because the rail band it covers is a developable strip. Its flat pattern is in the skin sheets, labelled RAIL.`
  : ''}

${m.plank
  ? `### The ends\n\n` +
    `The rail planks run the **whole length of the board**, tip to tip, ${len(m.plank.spanX[0], true)} to ${len(m.plank.spanX[1], true)}. ` +
    `The band they sit in narrows toward the tips but never closes: it holds a floor of ${len(minPlankBand(p), false)} wherever the ` +
    `section can carry one, so the plank stays ${len(Math.min(...m.plank.flatA.map((q, i) => Math.hypot(m.plank!.flatB[i].x - q.x, m.plank!.flatB[i].y - q.y))), false)} ` +
    `across at its narrowest.\n\n` +
    `Each plank is pinned by a tenon at every rib it passes, out to the last rib at each end, and stops a shoulder beyond it. ` +
    `The tenon and its mortise both taper with the band, so the joint stays proportioned all the way to the tips rather than ` +
    `running out of shoulder.` +
    (m.frame.endRibCount.tail + m.frame.endRibCount.nose
      ? ` The last ${m.frame.endRibCount.tail + m.frame.endRibCount.nose} ribs sit at a closer spacing to pin the plank ends and carry the planking round.`
      : '')
  : ''}

${p.railStrip
  ? `A **rebate is let into both rails** of every rib, ${len(p.railStripThickness - p.skinThickness, false)} deep and ${len(p.railStripHeight, false)} tall, for a solid wood rail strip. Fit the strips before planking: they take the knocks, they hold an edge when you sand the rails to shape, and they give the plank ends something solid to land on.`
  : ''}

${m.frame.ribsClampedToStringer ? `> The rib range you asked for ran past the ends of the stringer, where the board is too thin to hold one. The ribs below have been pulled in to the span the stringer actually covers.\n` : ''}
| Rib | x mm | x in | width mm | depth mm | slot mid z mm |
|---|---|---|---|---|---|
${stationTable}

## The skin

${p.skinStrips} strips per side, mirrored, so each shape is cut twice.
Strips are developed from the mid thickness of the planking, which means the
flat pattern lengths are the true lengths once the strip is bent onto the
frame.

| Strip | Length mm | Min width | Max width | Bevel keel side | Bevel deck side |
|---|---|---|---|---|---|
${stripTable}

Bevel angles are the average dihedral between neighbouring strips over the
middle of the board. Plane the edges to roughly those angles before laying a
strip down. Near the nose and tail the angle opens up, so fit those by eye.

Strip 1 lands on the keel, and the last strip closes on the deck centreline.
Work outward from the keel on both sides at once so the frame is not pulled
off centre.

${m.foamParts.length ? `## Foam

${m.foamParts.length} block shapes fill the bays between the ribs, ${s.foamLitres} L in all,
cut from ${len(p.foamThickness, false)} sheet and stacked to fill each bay. Each block is
taken from whichever of its two ribs is the smaller, so it will always go in;
laminate the layers, then sand the block back until it drops into place. A bay
is never quite the same shape at both ends and no flat pattern can be.

Foam is not structure. It is buoyancy if you ever hole the skin, and it stops
the panels drumming. Leave it out if you want the board as light as possible.

` : ''}${p.ventHole ? `A vent plug position is engraved on the deck centre strip near the tail. Drill it after the board is closed and sheathed, and fit a Gore vent. A sealed hollow board **will** split a seam on a hot day without one.` : 'No vent plug is marked. Fit one anyway: a sealed hollow board can split a seam when it heats up.'}

## Build order

1. Cut every frame part. Deburr the slots and test one rib on a stringer offcut.
${m.jigParts.length ? '1. Cut and assemble the cradle, and screw it down to something flat and straight.' : ''}
2. ${m.frame.stringers.length > 1 ? 'Glue the stringer splices flat, cure fully, then check the assembled stringer against `lines.csv`.' : 'Check the stringer against `lines.csv`.'}
3. Dry assemble the skeleton. Every rib should sit square with no gaps at the slot shoulders.
4. Glue the skeleton up on a flat strongback, using the datum line to set the heights.
5. Add rail blocks and any hardware blocks now: fin box, handle, leash plug, deck plate. There is no getting back inside later.
6. Plank the hull, keel outward. Then plank the deck.
7. Fair, sheathe in glass and epoxy, drill and fit the vent, then paint or varnish.

## What is in this bundle

\`\`\`
2d/svg/          one SVG per sheet, 1:1 mm
2d/dxf/          the same sheets as R12 DXF
                 frame_sheet_*  ribs and spines
                 foam_sheet_*   the foam blocks
                 block_sheet_*  the nose and tail block layers
                 skin_sheet_*   the planking
                 jig_sheet_*    the setup cradle, cut from scrap
3d/frame_assembled.stl   the whole skeleton in place
3d/hull_shape.stl        the outer surface, for reference or a scale print
3d/parts/                every frame part on its own, laid flat
cutlist.csv      every part, quantity, size and area
offsets.csv      rib stations and slot heights
lines.csv        the hull at 40 stations, for lofting or CAD
params.json      the exact inputs, reload them to regenerate this board
README.md        this file
\`\`\`

## Fine print

The shape is generated from closed form curves, so it is fair by
construction, but it has not been tank tested and neither have you. Build a
scale model first if you are changing the hull parameters a long way from a
preset. Check your own sheet stock thickness with calipers and put the real
number into \`plyThickness\` before you cut, because a 6 mm sheet is rarely
6 mm.
`
}
