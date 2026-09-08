# Herringbone

A browser app that turns a handful of sliders into a complete build kit for a
hollow, fishbone framed wooden stand up paddleboard: laser and CNC cut files,
STLs, and a build guide with the numbers you actually need at the bench.

Nothing is uploaded anywhere. The whole generator runs in the page.

## What comes out

| | |
|---|---|
| `2d/svg`, `2d/dxf` | Every part nested onto your sheet stock, 1:1 in millimetres, with kerf already compensated. Separate `cut`, `engrave` and `guide` layers. |
| `3d/frame_assembled.stl` | The whole skeleton in its assembled position. |
| `3d/hull_shape.stl` | The outer surface, for reference or a scale print. |
| `3d/parts/*.stl` | Each rib, stringer section and cradle panel on its own, laid flat. |
| `cutlist.csv` | Every part with quantity, size, area and notes. |
| `offsets.csv` | Rib stations, frame depths and slot heights. |
| `lines.csv` | The hull at 40 stations, for lofting or importing into CAD. |
| `README.md` | The build guide for that specific board. |
| `params.json` | The exact inputs, so the board is reproducible. |

## How the boat goes together

**Spines** run the length of the board and carry the rocker in their own
bottom edges. **Ribs** sit across them at each station, interlocking with half
laps that meet half way. Everything is inset from the finished surface by the
skin thickness, so the size you asked for is the size you get once planked.

You choose how many spines. An odd count puts one on the centreline; an even
count straddles it and leaves the middle of the board open. Anything off the
centreline is a planar panel at a fixed offset, so it still cuts flat and
stands vertical, and it is cut once and used on both sides.

The **skin** is developed into flat strips by unrolling each one triangle by
triangle between its edge curves. That is exact for a developable strip, so
the flat pattern length is the true length once the strip is bent onto the
frame. Rib stations are engraved across every strip.

Everything interlocks. No part is held by glue alone: every rib is half lapped
onto at least one spine, every spine stops a shoulder past its outermost joint
rather than running on as a cantilever, and the rail plank is pinned by the rib
tenons through its mortises. The self test asserts all of it, because a part
that floats is one you find out about with the glue open.

Several things fall out of the geometry rather than being drawn by hand:

- **Setup feet.** Sacrificial tabs under every rib reaching one common plane,
  so the assembled skeleton stands on a flat bench at the right rocker. Plank
  the deck, saw the feet off along their engraved line, turn it over, plank the
  hull. Turning feet on also flips the half laps, because a board standing hull
  down needs its spines resting on the ribs rather than hanging out of them.
- **Splices.** A spine longer than a sheet is cut into finger jointed sections,
  placed midway between ribs so no slot ever lands on a joint, with enough
  sections that every piece fits once the tabs are counted.
- **Joint numbers.** Every half lap is numbered on both halves, etched in
  single stroke text, so assembly is a matter of matching numbers.
- **Foam blocks.** Flat patterns filling every bay between the ribs, taken from
  whichever of the two ribs is smaller so the block always goes in.
- **The outer rail planks.** A plank down each rail running the **whole length
  of the board**, tip to tip. Cut flat, because the rail band it covers is a
  developable strip, with a mortise at every station. Each rib is seated back
  by the plank thickness and grows a tenon back out through it, so the planks
  hold the plan outline rather than the builder having to. The band narrows
  toward the tips but never closes: it holds a floor wherever the section can
  carry one, and the tenon and its mortise taper together so the joint stays
  proportioned right to the ends. Fit both before any other planking: they are
  what makes the frame rigid enough to plank against.
- **Closed ends.** A rib at each tip pins the plank ends and carries the
  planking round. Ordinary ribs at a closer spacing, each cut to its own
  station, so every part comes off the machine at the shape it needs to be.
  Nothing is carved and nothing is laminated.
- **Rail strips.** Or just a plain rebate at both rails for a bent solid strip,
  with no tenons.
- **The rocker cradle.** An alternative to feet: two panels whose top edge
  follows the underside of a spine, standing on a flat base.

Text cut into the parts is a **single stroke font**, not an outlined typeface.
CAM either ignores font references or needs glyphs converted to outlines, and
an outlined letter engraves as a filled shape rather than a scribed line.

## Units

The generator works in millimetres throughout and converts only for display,
so nothing accumulates rounding. The panel switches between inches and
millimetres, and the stock pickers write exact sizes: 8' x 4' sheets, 1/4"
ply, 1" foam, rather than whatever a slider step happens to land on. The
defaults are exact imperial sizes carried as their millimetre equivalents.

## Running it

```
pnpm install
pnpm dev         # http://localhost:5173
pnpm build       # typecheck, then a static bundle in dist/
pnpm check       # the self test, see below
```

pnpm needs to run esbuild's install script, which fetches its platform
binary. That permission lives in `pnpm-workspace.yaml` under `allowBuilds`.

The app keeps your board in `localStorage` and in the URL hash, so a link is
a complete board. Presets are a starting point, not a constraint.

## The self test

`pnpm check` runs the generator headless and asserts the things that would
otherwise cost you a sheet of marine ply:

1. **Presets** build with no part running off a sheet and no two parts
   overlapping. Overlap is tested with real polygon intersection, not bounding
   boxes, because the nester deliberately interlocks curved parts.
2. **Half lap joints** mesh. For every rib and every spine it crosses, it
   samples the little box of space the two share and asserts that no point is
   solid in both, and that both are solid somewhere, so the joint is engaged
   rather than merely clear. It also checks every rib's feet reach the one
   common plane, or the board will not sit level.
3. **The outer plank** has a mortise for every rib it reaches, those ribs grow
   a tenon, ribs beyond its ends grow none, and each mortise is at least as
   wide as the rib is thick. With the plank off, no plank parts are cut.
4. **Nothing floats.** Every rib has at least one half lap, rib slots and spine
   slots pair up exactly, and no spine or plank runs more than a shoulder past
   its outermost joint.
5. **The ends** are covered: the rail planks reach both tips, ribs run out to
   within a shoulder of each, and no gap along the board is wider than the main
   rib spacing.
6. **Nothing tapers to a knife edge.** The rail plank never narrows below its
   own thickness and no spine thins below twice its own, which is what an
   untrimmed panel does as it runs out toward a tip.
7. **Spine layouts** put a panel on the centreline for an odd count and leave
   it clear for an even one, and the open middle produces its own foam block.
8. **Outlines** do not fold back on themselves. An inward offset overshoots at
   a corner and leaves a lip; this walks the inset section at fifteen stations
   across four rail shapes and fails on any reversal long enough to see.
9. **Exported files** parse: STL triangle counts match their byte length and
   carry no non finite coordinates, SVGs have a viewBox and a cut layer, DXFs
   have balanced sections and polylines and no font based TEXT.
10. **Fuzz.** Random parameter combinations across the full slider ranges,
   weighted toward the extremes, checked for degenerate outlines, holes larger
   than their part, empty meshes, sheet overflow and nonsense statistics. It
   also fails if any build gets slow enough to stall the UI.

Set `N` to change the fuzz count: `N=500 pnpm check`.

The fuzz pass reports build times but only fails on something slow enough to
mean an algorithmic regression. Wall clock on a busy machine is noise.

## Layout

```
src/
  params.ts        every input, its default, its safe range, and the presets
  model.ts         ties it together; buildCore is the fast path for slider drags
  geom/
    vec.ts         2D geometry: polygon offset, arc length, winding
    hull.ts        the parametric surface. Closed form curves only
    frame.ts       ribs, spines, half laps, finger splices, cutouts, setup
                   feet, rail rebates, joint numbering, the rocker cradle
    foam.ts        blocks filling the bays between the ribs
    stroke.ts      the single stroke engraving font
    skin.ts        developing the planking and the rail plank into flat parts
    mesh.ts        extrusion and the hull shell
  export/
    nest.ts        shape aware skyline nesting
    svg.ts dxf.ts stl.ts docs.ts bundle.ts
  units.ts         display conversion and common US stock sizes
  ui/
    schema.ts      the control panel, described as data
    controls.ts viewer.ts markdown.ts
  selftest.ts      pnpm check
scripts/
  check.mjs        bundles the self test through esbuild's JS API and runs it
```

## Before you cut

Measure your actual sheet with calipers and put the real number into **Frame
ply**. A 6 mm sheet is rarely 6 mm, and every slot width comes straight off
that figure. Cut one rib and a short offcut of stringer first and check the
fit before committing a whole sheet.

The shapes are fair by construction, but they have not been tank tested. If
you are moving the hull parameters a long way from a preset, print the desk
model first.
