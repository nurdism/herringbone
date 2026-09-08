import type { Params } from '../params'

export type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params]
export type BoolKey = { [K in keyof Params]: Params[K] extends boolean ? K : never }[keyof Params]

export interface RangeField {
  kind: 'range'
  key: NumKey
  label: string
  min: number
  max: number
  step: number
  /** Slider step in inches when the panel is in imperial mode. */
  imperialStep?: number
  /** Display multiplier, e.g. 100 to show a 0..1 fraction as a percentage. */
  scale?: number
  unit?: string
  /** Also show the value in inches. */
  imperial?: boolean
  decimals?: number
  help?: string
}
export interface ToggleField { kind: 'toggle'; key: BoolKey; label: string; help?: string }
export interface TextField { kind: 'text'; key: 'name'; label: string; help?: string }
/** A row of quick picks that write real stock sizes rather than slider guesses. */
export interface StockField {
  kind: 'stock'
  what: 'sheet' | 'ply' | 'skin' | 'foam' | 'plank'
  label: string
  help?: string
}
export type Field = RangeField | ToggleField | TextField | StockField

export interface Group { id: string; title: string; open: boolean; fields: Field[] }

const r = (
  key: NumKey, label: string, min: number, max: number, step: number,
  extra: Partial<RangeField> = {},
): RangeField => ({ kind: 'range', key, label, min, max, step, ...extra })

const pct = (key: NumKey, label: string, min: number, max: number, help?: string): RangeField =>
  ({ kind: 'range', key, label, min, max, step: 0.005, scale: 100, unit: '%', decimals: 1, help })

export const GROUPS: Group[] = [
  {
    id: 'size', title: 'Size', open: true,
    fields: [
      r('length', 'Length', 1500, 5200, 10, { unit: 'mm', imperial: true, imperialStep: 0.5 }),
      r('width', 'Width', 500, 1000, 5, { unit: 'mm', imperial: true, imperialStep: 0.25 }),
      r('thickness', 'Thickness', 60, 220, 1, { unit: 'mm', imperial: true, imperialStep: 0.125, help: 'Deeper means more volume and a stiffer frame, and a higher rail to fight the wind.' }),
    ],
  },
  {
    id: 'outline', title: 'Plan outline', open: false,
    fields: [
      pct('widePoint', 'Wide point', 0.3, 0.7, 'Distance from the tail to the widest station. Forward of centre turns easily, back of centre tracks.'),
      pct('tailWidthFrac', 'Tail width', 0.05, 0.9, 'Width at the very tail as a share of the maximum.'),
      pct('noseWidthFrac', 'Nose width', 0.05, 0.9),
      r('planFullness', 'Rail straightness', 1.2, 5, 0.05, { unit: 'x', decimals: 2, help: 'Higher holds the maximum width over more of the length, which is more stable and less manoeuvrable.' }),
      r('planEndFullness', 'End bluntness', 1.2, 5, 0.05, { unit: 'x', decimals: 2, help: 'Higher rounds the nose and tail out. Lower draws them to a point.' }),
    ],
  },
  {
    id: 'rocker', title: 'Rocker', open: false,
    fields: [
      r('noseRocker', 'Nose rocker', 0, 260, 1, { unit: 'mm', imperial: true, imperialStep: 0.125, help: 'How far the nose lifts. More clears chop and steep drops, less is faster in flat water.' }),
      r('tailRocker', 'Tail rocker', 0, 140, 1, { unit: 'mm', imperial: true, imperialStep: 0.125 }),
      pct('rockerNoseStart', 'Nose rocker begins', 0.4, 0.9, 'Where the bottom leaves the flat, measured from the tail.'),
      pct('rockerTailStart', 'Tail rocker begins', 0.08, 0.55),
      r('rockerExp', 'Rocker curve', 1.4, 4, 0.05, { unit: 'x', decimals: 2, help: 'Higher keeps the middle flatter and puts the curve into the tips.' }),
    ],
  },
  {
    id: 'section', title: 'Foil and cross section', open: false,
    fields: [
      pct('noseThickFrac', 'Nose thickness', 0.05, 0.9),
      pct('tailThickFrac', 'Tail thickness', 0.05, 0.9),
      r('thickFullness', 'Thickness hold', 1.2, 5, 0.05, { unit: 'x', decimals: 2, help: 'Higher carries full thickness further toward the tips, which adds volume and stiffness.' }),
      pct('railFrac', 'Rail height', 0.2, 0.8, 'Where the rail apex sits in the thickness. Low is a boxy hull with a domed deck, high is a full soft rail.'),
      pct('railFlat', 'Flat rail band', 0, 0.7, 'A vertical flat face where the deck and hull meet, as a share of thickness. Zero draws them to a corner. A flat band is stiffer and much easier to plank.'),
      r('deckCrown', 'Deck crown', 1.3, 5, 0.05, { unit: 'x', decimals: 2, help: 'Higher is a flatter deck meeting a harder rail.' }),
      r('hullFlat', 'Hull flatness', 1.3, 7, 0.05, { unit: 'x', decimals: 2, help: 'Higher is a flatter, more stable bottom with a tighter turn at the rail.' }),
      r('bottomVee', 'Bottom vee', 0, 40, 0.5, { unit: 'mm', help: 'Rise at the rail relative to the keel. Vee rolls rail to rail more willingly.' }),
    ],
  },
  {
    id: 'frame', title: 'Fishbone frame', open: true,
    fields: [
      r('ribCount', 'Ribs', 4, 40, 1, { unit: '', help: 'More ribs hold the skin fairer and add weight. Aim for 7 to 10 inches apart.' }),
      r('spines', 'Spines', 1, 7, 1, { unit: '', help: 'Vertical panels running the length of the board. An odd count puts one down the centreline; an even count straddles it and leaves the middle open.' }),
      pct('spineSpread', 'Outer spine at', 0.15, 0.85, 'How far out the outermost pair of spines sits, as a share of the half width.'),
      { kind: 'stock', what: 'ply', label: 'Frame ply', help: 'Measure your actual sheet with calipers. Every slot width comes straight off this number.' },
      r('plyThickness', 'Frame ply', 1, 18, 0.05, { unit: 'mm', decimals: 2, imperial: true, imperialStep: 1 / 32 }),
      { kind: 'stock', what: 'skin', label: 'Skin stock' },
      r('skinThickness', 'Skin thickness', 0.5, 12, 0.05, { unit: 'mm', decimals: 2, imperial: true, imperialStep: 1 / 32, help: 'The whole frame is inset by this, so the finished shape lands on the size you asked for.' }),
      r('slotClearance', 'Slot fit', -0.3, 1, 0.05, { unit: 'mm', decimals: 2, help: 'Added to every slot. Zero is a hammer fit, 0.15 slides together, 0.4 leaves a glue line.' }),
      pct('ribInsetTail', 'First rib at', 0.02, 0.35),
      pct('ribInsetNose', 'Last rib at', 0.65, 0.98),
      { kind: 'toggle', key: 'ventHole', label: 'Mark a vent plug', help: 'A sealed hollow board can split a seam on a hot day. Fit a vent.' },
    ],
  },
  {
    id: 'cutouts', title: 'Cutouts', open: false,
    fields: [
      r('ribBays', 'Cutouts per half rib', 0, 8, 1, { unit: '', help: 'Zero leaves the ribs solid. Spines and the rail split the run further, so you may get more than this.' }),
      r('spineBays', 'Cutouts per spine bay', 0, 5, 1, { unit: '', help: 'How many cutouts go between one rib and the next along a spine.' }),
      r('webWidth', 'Web around a cutout', 6, 70, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 16, help: 'Material left between a cutout and the edge of the part, measured square to the edge.' }),
      pct('pocketFill', 'Cutout depth', 0.25, 1, 'How much of the available depth a cutout takes. Lower leaves more material and more stiffness.'),
      r('pocketRound', 'Cutout ends', 1.5, 10, 0.25, { unit: 'x', decimals: 2, help: 'Low draws the ends out into a long taper. High holds full height then turns off square.' }),
      { kind: 'toggle', key: 'lightenRibs', label: 'Cut out the ribs' },
      { kind: 'toggle', key: 'lightenStringer', label: 'Cut out the spines' },
    ],
  },
  {
    id: 'feet', title: 'Setup feet', open: true,
    fields: [
      { kind: 'toggle', key: 'ribFeet', label: 'Feet on the ribs', help: 'Sacrificial tabs that stand the frame on a flat bench at the right rocker, cut off once the deck is on. With feet the half laps flip over, so the spines rest on the ribs instead of hanging out of them.' },
      r('footHeight', 'Foot height', 10, 200, 1, { unit: 'mm', imperial: true, imperialStep: 0.25, help: 'Clear height under the lowest part of the frame. Feet toward the nose come out taller: that is the rocker.' }),
      r('footWidth', 'Foot width', 8, 120, 1, { unit: 'mm', imperial: true, imperialStep: 0.125 }),
    ],
  },
  {
    id: 'foam', title: 'Foam inserts', open: false,
    fields: [
      { kind: 'toggle', key: 'foamInserts', label: 'Cut foam blocks', help: 'Blocks that fill the bays between the ribs. Cut the layers, laminate them, sand to fit.' },
      { kind: 'stock', what: 'foam', label: 'Foam sheet' },
      r('foamThickness', 'Foam thickness', 5, 80, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 8 }),
      r('foamClearance', 'Foam clearance', 0, 10, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 32, help: 'Gap left around each block so it drops in without forcing the frame.' }),
    ],
  },
  {
    id: 'etch', title: 'Etching', open: false,
    fields: [
      { kind: 'toggle', key: 'etchLabels', label: 'Etch part names', help: 'Single stroke text cut into every part, so nothing is anonymous once it comes off the sheet.' },
      { kind: 'toggle', key: 'numberJoints', label: 'Number every joint', help: 'Each half lap gets a number etched on both halves, so assembly is a matter of matching numbers.' },
    ],
  },
  {
    id: 'skin', title: 'Planking', open: false,
    fields: [
      r('skinStrips', 'Strips per side', 3, 18, 1, { unit: '', help: 'More, narrower strips lie down over curvature more willingly and take longer to fit.' }),
      { kind: 'toggle', key: 'outerPlank', label: 'Outer rail plank', help: 'A plank down each rail running the whole length of the board, cut flat and mortised so every rib tenons into it. The plank then holds the plan outline instead of you holding it. It needs a flat rail band, so turning it on puts a floor under that all the way to the tips.' },
      { kind: 'stock', what: 'plank', label: 'Plank stock' },
      r('outerPlankThickness', 'Plank thickness', 2, 25, 0.05, { unit: 'mm', decimals: 2, imperial: true, imperialStep: 1 / 32 }),
      r('ribTenonHeight', 'Tenon height', 5, 60, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 16, help: 'Height of the tongue on each rib end. It is held inside the rail band, with a shoulder above and below.' }),
      { kind: 'toggle', key: 'endRibs', label: 'Extra ribs at the tips', help: 'Closer spaced ribs at the nose and tail, to pin the ends of the rail planks and carry the planking round. Ordinary ribs, each cut to its own station.' },
      r('endRibSpacing', 'End rib spacing', 10, 150, 1, { unit: 'mm', imperial: true, imperialStep: 0.25 }),
      { kind: 'toggle', key: 'railStrip', label: 'Rail strip rebate', help: 'A plain rebate at the rail for a bent solid strip, with no tenons. An alternative to the plank above rather than a companion to it.' },
      r('railStripThickness', 'Rail strip thickness', 2, 30, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 16 }),
      r('railStripHeight', 'Rail strip height', 6, 90, 1, { unit: 'mm', imperial: true, imperialStep: 1 / 8 }),
    ],
  },
  {
    id: 'jig', title: 'Setup cradle', open: false,
    fields: [
      { kind: 'toggle', key: 'rockerJig', label: 'Cut a rocker cradle', help: 'Two panels that hold the rocker while you glue the skeleton, cut from scrap. An alternative to feet on the ribs, not a companion to them.' },
      r('jigDepth', 'Cradle height', 30, 260, 1, { unit: 'mm', imperial: true, imperialStep: 0.25 }),
      r('jigClearance', 'Cradle clearance', 0, 12, 0.25, { unit: 'mm', decimals: 2, imperial: true, imperialStep: 1 / 32, help: 'Gap between the cradle and the frame, so squeeze out cannot glue them together.' }),
    ],
  },
  {
    id: 'machine', title: 'Stock and machine', open: false,
    fields: [
      { kind: 'stock', what: 'sheet', label: 'Sheet size' },
      r('sheetLength', 'Sheet length', 300, 3200, 5, { unit: 'mm', imperial: true, imperialStep: 1 }),
      r('sheetWidth', 'Sheet width', 200, 1600, 5, { unit: 'mm', imperial: true, imperialStep: 1 }),
      r('kerf', 'Kerf', 0, 4, 0.05, { unit: 'mm', decimals: 2, help: 'Total width the tool removes. Half of it is added to every cut path.' }),
      r('partSpacing', 'Gap between parts', 0, 30, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 16 }),
      r('fingerJointTeeth', 'Splice teeth', 3, 13, 2, { unit: '', help: 'Used where the stringer is longer than a sheet. Always odd.' }),
      r('fingerJointDepth', 'Splice tooth depth', 5, 90, 0.5, { unit: 'mm', decimals: 1, imperial: true, imperialStep: 1 / 8 }),
    ],
  },
  {
    id: 'meta', title: 'Name', open: false,
    fields: [{ kind: 'text', key: 'name', label: 'Board name', help: 'Used for the download folder and the title on every file.' }],
  },
]
