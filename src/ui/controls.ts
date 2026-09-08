import { Params, PRESETS, DEFAULTS } from '../params'
import { GROUPS, RangeField, StockField } from './schema'
import {
  FOAM_THICKNESS, PLY_THICKNESS, SHEET_SIZES, SKIN_THICKNESS,
  fmtAlt, fmtLen, stepFor, Units,
} from '../units'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function formatRange(f: RangeField, raw: number, units: Units): { main: string; alt: string } {
  if (f.unit === 'mm') {
    return { main: fmtLen(raw, units, { feet: f.imperial && Math.abs(raw) >= 600 }), alt: fmtAlt(raw, units) }
  }
  const shown = raw * (f.scale ?? 1)
  const d = f.decimals ?? (f.step < 1 ? 2 : 0)
  return { main: `${shown.toFixed(d)}${f.unit ? ` ${f.unit}` : ''}`, alt: '' }
}

export interface ControlsHandle {
  /** Push new values into the widgets without firing change events. */
  sync(p: Params): void
  markPreset(id: string | null): void
}

const STOCK = {
  ply: { list: PLY_THICKNESS, keys: ['plyThickness'] as const },
  skin: { list: SKIN_THICKNESS, keys: ['skinThickness'] as const },
  foam: { list: FOAM_THICKNESS, keys: ['foamThickness'] as const },
  plank: { list: PLY_THICKNESS, keys: ['outerPlankThickness'] as const },
}

export function mountControls(
  root: HTMLElement,
  get: () => Params,
  onChange: (patch: Partial<Params>, live: boolean) => void,
  onPreset: (id: string) => void,
): ControlsHandle {
  root.replaceChildren()
  const syncers: ((p: Params) => void)[] = []
  const presetButtons: HTMLButtonElement[] = []
  let units: Units = get().units

  // ---- units ----
  const ug = el('div', 'units-row')
  ug.append(el('span', 'ctrl-label', 'Units'))
  const uwrap = el('div', 'seg')
  for (const [id, label] of [['imperial', 'Inches'], ['metric', 'Millimetres']] as const) {
    const b = el('button', '', label)
    b.dataset.units = id
    b.addEventListener('click', () => onChange({ units: id }, false))
    uwrap.append(b)
  }
  ug.append(uwrap)
  root.append(ug)
  syncers.push((p) => {
    units = p.units
    for (const b of uwrap.querySelectorAll('button')) b.classList.toggle('on', b.dataset.units === p.units)
  })

  // ---- presets ----
  const pg = el('details', 'group')
  pg.setAttribute('open', '')
  pg.append(el('summary', '', 'Start from'))
  const grid = el('div', 'presets')
  for (const preset of PRESETS) {
    const b = el('button', 'ghost')
    b.append(el('b', '', preset.label), el('span', '', preset.blurb))
    b.title = preset.blurb
    b.dataset.preset = preset.id
    b.addEventListener('click', () => onPreset(preset.id))
    presetButtons.push(b)
    grid.append(b)
  }
  pg.append(grid)
  root.append(pg)

  // ---- generated groups ----
  for (const g of GROUPS) {
    const d = el('details', 'group')
    if (g.open) d.setAttribute('open', '')
    d.append(el('summary', '', g.title))
    const body = el('div', 'group-body')

    for (const f of g.fields) {
      if (f.kind === 'range') {
        const wrap = el('div', 'ctrl')
        const head = el('div', 'ctrl-head')
        const val = el('span', 'ctrl-val')
        head.append(el('span', 'ctrl-label', f.label), val)
        const input = el('input')
        input.type = 'range'
        input.min = String(f.min)
        input.max = String(f.max)
        input.step = String(f.step)
        const paint = (raw: number) => {
          const { main, alt } = formatRange(f, raw, units)
          val.replaceChildren(document.createTextNode(main))
          if (alt) { const a = el('span', 'alt', `  ${alt}`); val.append(a) }
        }
        input.addEventListener('input', () => {
          const v = Number(input.value)
          paint(v)
          onChange({ [f.key]: v } as Partial<Params>, true)
        })
        input.addEventListener('change', () => onChange({ [f.key]: Number(input.value) } as Partial<Params>, false))
        wrap.append(head, input)
        if (f.help) wrap.append(el('div', 'help', f.help))
        body.append(wrap)
        syncers.push((p) => {
          // in imperial the slider lands on real fractions rather than
          // whatever a metric step happens to convert to
          input.step = String(stepFor(p.units, f.step, f.imperialStep))
          const v = p[f.key] as number
          input.value = String(v)
          paint(v)
        })
      } else if (f.kind === 'stock') {
        const sf = f as StockField
        const wrap = el('div', 'ctrl stock')
        wrap.append(el('div', 'ctrl-label', sf.label))
        const chips = el('div', 'chips')
        wrap.append(chips)
        if (sf.help) wrap.append(el('div', 'help', sf.help))
        body.append(wrap)
        syncers.push((p) => {
          chips.replaceChildren()
          if (sf.what === 'sheet') {
            for (const opt of SHEET_SIZES[p.units]) {
              const b = el('button', 'ghost', opt.label)
              const on = Math.abs(p.sheetLength - opt.length) < 0.5 && Math.abs(p.sheetWidth - opt.width) < 0.5
              b.classList.toggle('sel', on)
              b.addEventListener('click', () => onChange({ sheetLength: opt.length, sheetWidth: opt.width }, false))
              chips.append(b)
            }
            return
          }
          const spec = STOCK[sf.what]
          const key = spec.keys[0]
          for (const opt of spec.list[p.units]) {
            const b = el('button', 'ghost', opt.label)
            b.classList.toggle('sel', Math.abs((p[key] as number) - opt.value) < 0.02)
            b.addEventListener('click', () => onChange({ [key]: opt.value } as Partial<Params>, false))
            chips.append(b)
          }
        })
      } else if (f.kind === 'toggle') {
        const wrap = el('div', 'ctrl toggle')
        const input = el('input')
        input.type = 'checkbox'
        input.id = `t-${f.key}`
        const lab = el('label', '', f.label)
        lab.htmlFor = input.id
        input.addEventListener('change', () => onChange({ [f.key]: input.checked } as Partial<Params>, false))
        wrap.append(input, lab)
        body.append(wrap)
        if (f.help) body.append(el('div', 'help', f.help))
        syncers.push((p) => { input.checked = p[f.key] as boolean })
      } else {
        const wrap = el('div', 'ctrl text')
        wrap.append(el('div', 'ctrl-label', f.label))
        const input = el('input')
        input.type = 'text'
        input.spellcheck = false
        input.addEventListener('change', () => {
          const clean = input.value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'
          input.value = clean
          onChange({ name: clean }, false)
        })
        wrap.append(input)
        if (f.help) wrap.append(el('div', 'help', f.help))
        body.append(wrap)
        syncers.push((p) => { if (document.activeElement !== input) input.value = p.name })
      }
    }
    d.append(body)
    root.append(d)
  }

  // ---- reset ----
  const foot = el('div', 'group-body')
  const reset = el('button', 'ghost', 'Reset everything to the default board')
  reset.style.width = '100%'
  reset.addEventListener('click', () => onChange({ ...DEFAULTS }, false))
  foot.append(reset)
  root.append(foot)

  const handle: ControlsHandle = {
    sync(p) { for (const s of syncers) s(p) },
    markPreset(id) { for (const b of presetButtons) b.classList.toggle('sel', b.dataset.preset === id) },
  }
  handle.sync(get())
  return handle
}
