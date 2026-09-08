/**
 * Every dimension in this file is in millimetres unless the name says otherwise.
 * Angles are radians. Fractions are 0..1 unless a comment says otherwise.
 */

import { mm } from './units'
import type { Units } from './units'

export interface Params {
  name: string
  /** Display only. The generator always works in millimetres. */
  units: Units

  // ---- overall envelope ----
  length: number // tail tip to nose tip
  width: number // maximum width
  thickness: number // maximum thickness at the centreline

  // ---- plan outline ----
  widePoint: number // 0 = tail, 1 = nose. Where max width occurs
  tailWidthFrac: number // width at the very tail as a fraction of max width
  noseWidthFrac: number // width at the very nose as a fraction of max width
  planFullness: number // higher keeps the rails parallel for longer
  planEndFullness: number // higher makes the nose and tail blunter

  // ---- rocker (bottom centreline) ----
  noseRocker: number // rise of the bottom at the nose tip
  tailRocker: number // rise of the bottom at the tail tip
  rockerNoseStart: number // 0..1, where the nose rocker leaves the flat
  rockerTailStart: number // 0..1, where the tail rocker leaves the flat
  rockerExp: number // curve exponent, 2 = parabolic, 3 = flatter then kickier

  // ---- thickness distribution ----
  noseThickFrac: number // thickness at the nose tip / max thickness
  tailThickFrac: number
  thickFullness: number // higher keeps full thickness over more of the length

  // ---- cross section ----
  railFrac: number // rail apex height as a fraction of local thickness
  railFlat: number // height of a vertical flat band at the rail, as a fraction of thickness
  deckCrown: number // deck dome exponent, higher = flatter deck with harder rail
  hullFlat: number // hull flatness exponent, higher = flatter bottom
  bottomVee: number // extra rise at the rail from vee, mm at the widest station

  // ---- construction ----
  skinThickness: number // planking thickness, frame is inset by this
  plyThickness: number // frame sheet material thickness
  ribCount: number
  ribInsetTail: number // 0..1, station of the first rib
  ribInsetNose: number // 0..1, station of the last rib
  slotClearance: number // added to every slot width for a sliding fit
  webWidth: number // material left around a cutout
  ribBays: number // cutouts across each half of a rib
  spineBays: number // cutouts per rib bay along a spine
  pocketFill: number // 0..1, how much of the available depth a cutout takes
  pocketRound: number // end shape, low is a long taper, high is nearly square
  lightenRibs: boolean
  lightenStringer: boolean
  /**
   * Total vertical panels running the length of the board. An odd count puts
   * one on the centreline, an even count straddles it and leaves the middle
   * of the board open.
   */
  spines: number
  spineSpread: number // 0..1, how far out the outermost pair sits

  // ---- setup feet ----
  ribFeet: boolean // sacrificial tabs so the frame stands on a bench, cut off later
  footHeight: number // clear height under the lowest part of the frame
  footWidth: number // width of each tab

  // ---- rail strips and the outer plank ----
  railStrip: boolean // a solid wood strip let into the rail, instead of skin there
  railStripThickness: number // how far it stands proud of the frame
  railStripHeight: number // its vertical extent at the rail
  /**
   * A plank covering the flat rail band, cut flat and mortised so every rib
   * tenons into it. The plank then sets the plan outline rather than the
   * builder having to hold it.
   */
  outerPlank: boolean
  outerPlankThickness: number
  ribTenonHeight: number // vertical height of the tenon on each rib
  /**
   * Extra ribs closing the nose and tail, where the rail band runs out and the
   * plank has to stop. They are ordinary ribs at a closer spacing, each cut to
   * its own station, so the ends are carried by flat parts off the machine
   * rather than by a block that has to be carved.
   */
  endRibs: boolean
  endRibSpacing: number

  // ---- foam ----
  foamInserts: boolean // also cut foam blocks to fill the bays between ribs
  foamThickness: number // thickness of your foam sheet, blocks are stacked to fill
  foamClearance: number // gap left around each block
  ventHole: boolean // drill mark for a Gore vent plug in the deck near the tail
  etchLabels: boolean // etch part names into the parts as single stroke text
  numberJoints: boolean // number every half lap so assembly is connect the dots
  rockerJig: boolean // also cut a cradle that holds the rocker during glue up
  jigDepth: number // how tall the cradle stands below the lowest point of the frame
  jigClearance: number // gap between the cradle and the frame

  // ---- sheet stock and machine ----
  sheetWidth: number
  sheetLength: number
  kerf: number // total kerf width, parts are offset out by half of this
  partSpacing: number // gap between nested parts
  fingerJointTeeth: number // teeth per stringer splice
  fingerJointDepth: number // how far the teeth stick out

  // ---- skin ----
  skinStrips: number // developable planking strips per side, keel to centre deck
}

// A tool aimed at a US workshop, so the defaults are exact imperial sizes
// carried as their millimetre equivalents.
export const DEFAULTS: Params = {
  name: 'allrounder-10-6',
  units: 'imperial',

  length: mm(126), // 10'6"
  width: mm(32),
  thickness: mm(5),

  widePoint: 0.54,
  tailWidthFrac: 0.42,
  noseWidthFrac: 0.2,
  planFullness: 2.2,
  planEndFullness: 2.6,

  noseRocker: mm(4.125),
  tailRocker: mm(1.25),
  rockerNoseStart: 0.55,
  rockerTailStart: 0.34,
  rockerExp: 2.3,

  noseThickFrac: 0.22,
  tailThickFrac: 0.34,
  thickFullness: 2.6,

  railFrac: 0.55,
  railFlat: 0.15,
  deckCrown: 2.4,
  hullFlat: 3.0,
  bottomVee: 6,

  skinThickness: mm(1 / 8),
  plyThickness: mm(1 / 4),
  ribCount: 15,
  ribInsetTail: 0.055,
  ribInsetNose: 0.945,
  slotClearance: 0.15, // about 0.006", a sliding fit
  webWidth: mm(7 / 8),
  ribBays: 3,
  spineBays: 1,
  pocketFill: 1,
  pocketRound: 6,
  lightenRibs: true,
  lightenStringer: true,
  spines: 3,
  spineSpread: 0.62,

  ribFeet: true,
  footHeight: mm(1.75),
  footWidth: mm(1.25),

  railStrip: false,
  railStripThickness: mm(1 / 2),
  railStripHeight: mm(1),
  outerPlank: true,
  outerPlankThickness: mm(1 / 4),
  ribTenonHeight: mm(1 / 2),
  endRibs: true,
  endRibSpacing: mm(1.5),

  foamInserts: true,
  foamThickness: mm(1),
  foamClearance: mm(1 / 16),
  ventHole: true,
  etchLabels: true,
  numberJoints: true,
  rockerJig: false,
  jigDepth: mm(3.5),
  jigClearance: mm(1 / 8),

  sheetWidth: mm(48),
  sheetLength: mm(96),
  kerf: 0.2,
  partSpacing: mm(1 / 4),
  fingerJointTeeth: 5,
  fingerJointDepth: mm(7 / 8),

  skinStrips: 7,
}

/**
 * The narrowest rail band still worth planking: enough section to be a plank,
 * and enough for a tenon to land in. The tenon itself shrinks with the band,
 * so this only has to guarantee there is something there at all.
 */
export function minPlankBand(p: Params): number {
  return Math.max(p.outerPlankThickness * 2, p.skinThickness * 3, 6)
}

/**
 * Transverse offsets of the longitudinal panels, ascending, unsigned.
 * An odd count starts at 0, an even count starts off the centreline and the
 * middle of the board stays open.
 */
export function spineOffsets(p: Params): number[] {
  const n = Math.max(1, Math.round(p.spines))
  const reach = (p.width / 2) * p.spineSpread
  if (n === 1) return [0]
  if (n % 2 === 1) {
    const k = (n - 1) / 2
    return Array.from({ length: k + 1 }, (_, j) => (reach * j) / k)
  }
  const k = n / 2
  return Array.from({ length: k }, (_, j) => (reach * (2 * j + 1)) / (2 * k - 1))
}

export interface Preset {
  id: string
  label: string
  blurb: string
  patch: Partial<Params>
}

export const PRESETS: Preset[] = [
  {
    id: 'allround',
    label: `All-round 10'6"`,
    blurb: 'The forgiving default. Wide, stable, plenty of volume.',
    patch: { ...DEFAULTS },
  },
  {
    id: 'touring',
    label: `Touring 12'6"`,
    blurb: 'Longer waterline, pointed nose, less rocker. Tracks and glides.',
    patch: {
      name: 'touring-12-6',
      length: mm(150), // 12'6"
      width: mm(30),
      thickness: mm(5.5),
      widePoint: 0.5,
      noseWidthFrac: 0.12,
      tailWidthFrac: 0.38,
      planFullness: 2.6,
      planEndFullness: 3.4,
      noseRocker: mm(5.125),
      tailRocker: mm(0.875),
      rockerNoseStart: 0.62,
      rockerTailStart: 0.28,
      ribCount: 17,
      skinStrips: 8,
      spines: 5,
    },
  },
  {
    id: 'surf',
    label: `Surf 9'0"`,
    blurb: 'Short, curvy, loose. More rocker top and tail, thinner rails.',
    patch: {
      name: 'surf-9-0',
      length: mm(108), // 9'0"
      width: mm(31),
      thickness: mm(4.25),
      widePoint: 0.56,
      noseWidthFrac: 0.26,
      tailWidthFrac: 0.36,
      planFullness: 1.7,
      planEndFullness: 2.2,
      noseRocker: mm(4.875),
      tailRocker: mm(2.125),
      rockerNoseStart: 0.48,
      rockerTailStart: 0.4,
      railFrac: 0.5,
      railFlat: 0.06,
      deckCrown: 2.0,
      ribCount: 13,
      skinStrips: 6,
    },
  },
  {
    id: 'race',
    label: `Race 14'0"`,
    blurb: 'Narrow displacement hull, near flat rocker, maximum waterline.',
    patch: {
      name: 'race-14-0',
      length: mm(168), // 14'0"
      width: mm(26),
      thickness: mm(6.125),
      widePoint: 0.48,
      noseWidthFrac: 0.08,
      tailWidthFrac: 0.42,
      planFullness: 3.0,
      planEndFullness: 4.0,
      noseRocker: mm(3.75),
      tailRocker: mm(0.5),
      rockerNoseStart: 0.68,
      rockerTailStart: 0.2,
      hullFlat: 2.2,
      bottomVee: 16,
      ribCount: 19,
      skinStrips: 9,
      spines: 5,
    },
  },
  {
    id: 'model',
    label: 'Desk model 1:8',
    blurb: 'The all-round board scaled for a 3D printer. Prints the frame as parts.',
    patch: {
      name: 'desk-model-1-8',
      units: 'metric',
      // a mortised rail plank on a 16 mm thick model is not a real joint
      outerPlank: false,
      endRibSpacing: 12,
      length: 400,
      width: 102,
      thickness: 16,
      noseRocker: 13,
      tailRocker: 4,
      skinThickness: 0.8,
      plyThickness: 1.6,
      ribCount: 11,
      webWidth: 3,
      ribBays: 2,
      fingerJointDepth: 5,
      jigDepth: 14,
      jigClearance: 0.6,
      footHeight: 8,
      footWidth: 6,
      foamThickness: 6,
      foamClearance: 0.5,
      spines: 1,
      sheetWidth: 220,
      sheetLength: 220,
      partSpacing: 2,
      skinStrips: 5,
    },
  },
]

/** Clamp anything a user can type into a range the geometry can actually build. */
export function sanitize(p: Params): Params {
  const q = { ...p }
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  q.length = cl(q.length, 300, 6000)
  q.width = cl(q.width, 80, 1400)
  q.thickness = cl(q.thickness, 10, 400)
  q.widePoint = cl(q.widePoint, 0.25, 0.75)
  q.tailWidthFrac = cl(q.tailWidthFrac, 0.02, 0.95)
  q.noseWidthFrac = cl(q.noseWidthFrac, 0.02, 0.95)
  q.planFullness = cl(q.planFullness, 1.05, 6)
  q.planEndFullness = cl(q.planEndFullness, 1.05, 6)
  q.rockerNoseStart = cl(q.rockerNoseStart, q.widePoint * 0.5, 0.95)
  q.rockerTailStart = cl(q.rockerTailStart, 0.05, q.widePoint)
  q.rockerExp = cl(q.rockerExp, 1.2, 5)
  q.noseThickFrac = cl(q.noseThickFrac, 0.05, 0.95)
  q.tailThickFrac = cl(q.tailThickFrac, 0.05, 0.95)
  q.thickFullness = cl(q.thickFullness, 1.05, 6)
  q.railFrac = cl(q.railFrac, 0.15, 0.85)
  q.railFlat = cl(q.railFlat, 0, 0.7)
  q.deckCrown = cl(q.deckCrown, 1.2, 6)
  q.hullFlat = cl(q.hullFlat, 1.2, 8)
  q.bottomVee = cl(q.bottomVee, 0, q.thickness * 0.4)
  q.skinThickness = cl(q.skinThickness, 0.2, 30)
  q.plyThickness = cl(q.plyThickness, 0.4, 30)
  q.ribCount = Math.round(cl(q.ribCount, 3, 60))
  q.ribInsetTail = cl(q.ribInsetTail, 0.01, 0.45)
  q.ribInsetNose = cl(q.ribInsetNose, 0.55, 0.99)
  q.slotClearance = cl(q.slotClearance, -0.5, 2)
  q.webWidth = cl(q.webWidth, 1, 120)
  q.ribBays = Math.round(cl(q.ribBays, 0, 8))
  q.spineBays = Math.round(cl(q.spineBays, 0, 5))
  q.pocketFill = cl(q.pocketFill, 0.25, 1)
  q.pocketRound = cl(q.pocketRound, 1.5, 10)
  q.spines = Math.round(cl(q.spines, 1, 7))
  q.spineSpread = cl(q.spineSpread, 0.15, 0.85)
  q.footHeight = cl(q.footHeight, 5, 300)
  q.footWidth = cl(q.footWidth, 4, 200)
  q.railStripThickness = cl(q.railStripThickness, q.skinThickness, 40)
  q.outerPlankThickness = cl(q.outerPlankThickness, 1, 30)
  q.endRibSpacing = cl(q.endRibSpacing, 8, 200)
  // A plank needs a flat rail band to lie on, and the tenon needs shoulders
  // above and below it, so asking for the plank puts a minimum band on the
  // section and keeps the tenon comfortably inside it.
  if (q.outerPlank) {
    q.railFlat = Math.max(q.railFlat, 0.2)
    q.ribTenonHeight = cl(q.ribTenonHeight, 4, q.thickness * q.railFlat * 0.55)
  } else {
    q.ribTenonHeight = cl(q.ribTenonHeight, 4, q.thickness * 0.6)
  }
  q.railStripHeight = cl(q.railStripHeight, 5, q.thickness * 0.8)
  q.foamThickness = cl(q.foamThickness, 2, 120)
  q.foamClearance = cl(q.foamClearance, 0, 15)
  q.jigDepth = cl(q.jigDepth, 10, 400)
  q.jigClearance = cl(q.jigClearance, 0, 20)
  q.sheetWidth = cl(q.sheetWidth, 100, 4000)
  q.sheetLength = cl(q.sheetLength, 100, 6000)
  q.kerf = cl(q.kerf, 0, 6)
  q.partSpacing = cl(q.partSpacing, 0, 60)
  q.fingerJointTeeth = Math.round(cl(q.fingerJointTeeth, 3, 15)) | 1 // odd, so both ends of a tooth row are tabs
  q.fingerJointDepth = cl(q.fingerJointDepth, 3, 120)
  q.skinStrips = Math.round(cl(q.skinStrips, 2, 24))
  return q
}
