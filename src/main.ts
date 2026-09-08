import './style.css'
import { DEFAULTS, Params, PRESETS, sanitize } from './params'
import { buildCore, buildModel, BoardModel, CoreModel } from './model'
import { fmtLen, fmtMass } from './units'
import { mountControls } from './ui/controls'
import { DEFAULT_VIEW, Viewer, ViewOptions, webglSupport } from './ui/viewer'
import { renderMarkdown } from './ui/markdown'
import { sheetToSvg } from './export/svg'
import { sheetToDxf } from './export/dxf'
import { buildDoc, cutlistCsv, linesCsv, offsetsCsv } from './export/docs'
import { buildBundle, download, textBlob } from './export/bundle'
import { sheetYield, Sheet } from './export/nest'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

// ---------------------------------------------------------------- state

const STORE_KEY = 'herringbone:params'

function readUrl(): Partial<Params> | null {
  const h = location.hash.replace(/^#/, '')
  if (!h) return null
  try { return JSON.parse(decodeURIComponent(escape(atob(h)))) } catch { return null }
}
function writeUrl(p: Params) {
  const diff: Record<string, unknown> = {}
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    if (p[k] !== DEFAULTS[k]) diff[k] = p[k]
  }
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(diff))))
  history.replaceState(null, '', `#${enc}`)
}

function loadParams(): Params {
  const fromUrl = readUrl()
  if (fromUrl) return sanitize({ ...DEFAULTS, ...fromUrl })
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return sanitize({ ...DEFAULTS, ...JSON.parse(raw) })
  } catch { /* private mode, first run, whatever */ }
  return sanitize({ ...DEFAULTS })
}

let params = loadParams()
let core: CoreModel = buildCore(params)
let model: BoardModel | null = null
let view: ViewOptions = { ...DEFAULT_VIEW }

// ---------------------------------------------------------------- chrome

const statusEl = $('#status')
let statusTimer = 0
function setStatus(text: string, kind: '' | 'busy' | 'err' = '', holdMs = 0) {
  clearTimeout(statusTimer)
  statusEl.textContent = text
  statusEl.className = `status ${kind}`
  if (holdMs) statusTimer = window.setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'status' }, holdMs)
}

/**
 * The 3D preview is the only part of this that needs a GPU. Everything the
 * tool actually produces, the cut sheets, the notes and the download, is 2D
 * and text, so a browser without WebGL loses the preview and nothing else.
 */
let viewer: Viewer | null = null

function showViewerError(reason: string) {
  viewer = null
  const wrap = $('.viewer-wrap')
  wrap.replaceChildren()
  const box = el('div', 'viewer-error')
  box.append(
    el('h2', '', 'No 3D preview here'),
    el('p', '', reason),
    el('p', 'muted', 'Nothing else is affected. The cut sheets, the build notes and the download are all generated from the same model and need no graphics hardware.'),
  )
  const row = el('div', 'viewer-error-actions')
  const go = el('button', 'primary', 'Go to the cut sheets')
  go.addEventListener('click', () => $<HTMLButtonElement>('[data-tab=sheets]').click())
  const notes = el('button', 'ghost', 'Build notes')
  notes.addEventListener('click', () => $<HTMLButtonElement>('[data-tab=notes]').click())
  row.append(go, notes)
  box.append(row)
  wrap.append(box)
  setStatus('3D preview unavailable', 'err')
}

function startViewer() {
  const support = webglSupport()
  if (!support.ok) { showViewerError(support.reason); return }
  try {
    viewer = new Viewer($<HTMLCanvasElement>('#canvas'), showViewerError)
  } catch (err) {
    console.error(err)
    showViewerError((err as Error).message)
  }
}
startViewer()

// ---------------------------------------------------------------- stat bar

function renderStats() {
  const bar = $('#statbar')
  const p = params
  const s = model?.stats
  const items: { k: string; v: string; sub?: string; cls?: string }[] = [
    { k: 'Board', v: fmtLen(p.length, p.units, { feet: true }), sub: `${fmtLen(p.width, p.units)} x ${fmtLen(p.thickness, p.units)}` },
    { k: 'Volume', v: s ? `${s.volumeLitres} L` : '...', cls: 'hero' },
    { k: 'Est. weight', v: s ? `${fmtMass(s.estWeightLoKg, p.units)}-${fmtMass(s.estWeightHiKg, p.units)}` : '...' },
    { k: 'Ribs', v: `${core.frame.ribs.length}`, sub: s ? fmtLen(s.mainRibSpacing, p.units) + ' apart' : '' },
    {
      k: 'Spines',
      v: `${core.frame.longitudinals.reduce((a, l) => a + (l.y === 0 ? 1 : 2), 0)}`,
      sub: core.frame.longitudinals[0]?.y ? 'middle open' : 'one on centre',
    },
    { k: 'Frame sheets', v: s ? `${s.frameSheets}` : '...', sub: `${fmtLen(p.plyThickness, p.units)} ply` },
    { k: 'Skin sheets', v: s ? `${s.skinSheets}` : '...', sub: fmtLen(p.skinThickness, p.units) },
  ]
  if (p.foamInserts && s?.foamSheets) items.push({ k: 'Foam sheets', v: `${s.foamSheets}`, sub: `${s.foamLitres} L` })
  if (s?.endRibCount) items.push({ k: 'End ribs', v: `${s.endRibCount}`, sub: `closing the tips` })
  if (p.rockerJig && s?.jigSheets) items.push({ k: 'Cradle', v: `${s.jigSheets}`, sub: 'scrap sheets' })
  const rejected = model
    ? model.frameNest.rejected.length + (model.jigNest?.rejected.length ?? 0) +
      (model.foamNest?.rejected.length ?? 0) + model.skinNest.rejected.length
    : 0
  if (rejected) items.push({ k: 'Too big for stock', v: `${rejected}`, cls: 'warn' })

  bar.replaceChildren(
    ...items.map((it) => {
      const d = el('div', `stat ${it.cls ?? ''}`)
      d.append(el('div', 'k', it.k))
      const v = el('div', 'v')
      v.append(document.createTextNode(it.v))
      if (it.sub) v.append(el('em', '', `  ${it.sub}`))
      d.append(v)
      return d
    }),
  )
}

// ---------------------------------------------------------------- sheets pane

function sheetCard(s: Sheet, kindLabel: string): HTMLElement {
  const card = el('div', 'sheet-card')
  const head = el('div', 'sheet-head')
  head.append(
    el('h3', '', `${kindLabel} sheet ${s.index}`),
    el(
      'span', 'meta',
      `${fmtLen(s.length, params.units, { feet: true })} x ${fmtLen(s.width, params.units, { feet: true })}` +
      `  ·  ${s.placements.length} parts  ·  ${Math.round(sheetYield(s) * 100)}% of the sheet used`,
    ),
  )
  const dl = el('div', 'dl')
  const svgText = sheetToSvg(s, `${params.name} ${kindLabel} sheet ${s.index}`)
  const base = `${params.name}_${kindLabel.toLowerCase().replace(/\s+/g, '_')}_sheet_${String(s.index).padStart(2, '0')}`
  const bSvg = el('button', 'ghost', 'SVG')
  bSvg.addEventListener('click', () => download(textBlob(svgText, 'image/svg+xml'), `${base}.svg`))
  const bDxf = el('button', 'ghost', 'DXF')
  bDxf.addEventListener('click', () => download(textBlob(sheetToDxf(s), 'application/dxf'), `${base}.dxf`))
  dl.append(bSvg, bDxf)
  head.append(dl)

  const box = el('div', 'sheet-svg')
  box.innerHTML = svgText.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/ width="[^"]*" height="[^"]*"/, '')
  // The file itself keeps its 0.1 mm hairline for the machine. On screen the
  // sheet is scaled down to a few hundred pixels, so fatten the lines to see them.
  const lw = s.length / 900
  box.querySelector('#cut')?.setAttribute('stroke-width', String(lw))
  box.querySelector('#engrave')?.setAttribute('stroke-width', String(lw * 0.8))
  box.querySelector('#guide')?.setAttribute('stroke-width', String(lw * 2))
  card.append(head, box)
  return card
}

function renderSheets() {
  const pane = $('#pane-sheets')
  if (!model) { pane.replaceChildren(el('div', 'sheets', 'Working...')); return }
  const wrap = el('div', 'sheets')

  const rejected = [
    ...model.frameNest.rejected, ...(model.jigNest?.rejected ?? []),
    ...(model.foamNest?.rejected ?? []), ...model.skinNest.rejected,
  ]
  if (rejected.length) {
    const n = el('div', 'notice')
    n.innerHTML = `<b>${rejected.length} part${rejected.length > 1 ? 's do' : ' does'} not fit your stock.</b> ` +
      `Raise the sheet size, or make the parts smaller: more skin strips, or fewer ribs on a longer board.<br>` +
      rejected.map((r) => `<code>${r.part.id}</code> ${r.reason}`).join('<br>')
    wrap.append(n)
  }

  const groups: [string, Sheet[]][] = [
    ['Frame', model.frameNest.sheets],
    ['Foam', model.foamNest?.sheets ?? []],
    ['Skin', model.skinNest.sheets],
    ['Cradle', model.jigNest?.sheets ?? []],
  ]
  for (const [label, sheets] of groups) {
    if (!sheets.length) continue
    wrap.append(el('div', 'section-title', `${label}  ·  ${sheets.length} sheet${sheets.length > 1 ? 's' : ''} of ${sheets[0].material}`))
    for (const s of sheets) wrap.append(sheetCard(s, label))
  }

  const extras = el('div', 'section-title', 'Tables')
  wrap.append(extras)
  const row = el('div', 'sheet-head')
  for (const [name, gen] of [
    ['cutlist.csv', () => cutlistCsv(model!)],
    ['offsets.csv', () => offsetsCsv(model!)],
    ['lines.csv', () => linesCsv(model!)],
  ] as const) {
    const b = el('button', 'ghost', name)
    b.addEventListener('click', () => download(textBlob(gen(), 'text/csv'), `${params.name}_${name}`))
    row.append(b)
  }
  wrap.append(row)
  pane.replaceChildren(wrap)
}

// ---------------------------------------------------------------- notes pane

function renderNotes() {
  const pane = $('#pane-notes')
  if (!model) { pane.replaceChildren(el('div', 'doc', 'Working...')); return }
  const d = el('div', 'doc')
  d.innerHTML = renderMarkdown(buildDoc(model))
  pane.replaceChildren(d)
}

// ---------------------------------------------------------------- viewer chrome

function renderViewerTools() {
  const tools = document.querySelector('#viewer-tools')
  if (!tools || !viewer) return
  tools.replaceChildren()
  const toggles: [keyof ViewOptions, string][] = [
    ['skin', 'Skin'],
    ['frame', 'Frame'],
    ['plank', 'Rail plank'],
    ['cradle', 'Cradle'],
    ['cutaway', 'Cutaway'],
  ]
  for (const [key, label] of toggles) {
    const b = el('button', view[key] ? 'on' : '', label)
    b.addEventListener('click', () => {
      view = { ...view, [key]: !view[key] }
      viewer?.setOptions(view)
      renderViewerTools()
    })
    tools.append(b)
  }
  const views = el('div')
  views.style.cssText = 'display:flex;gap:6px;margin-top:6px'
  for (const v of ['iso', 'side', 'top', 'front'] as const) {
    const b = el('button', 'ghost', v)
    b.addEventListener('click', () => viewer?.setView(v, params.length))
    views.append(b)
  }
  tools.append(views)
}

function renderHud() {
  const p = params
  const s = model?.stats
  const hud = document.querySelector('#viewer-hud')
  if (!hud) return
  hud.innerHTML =
    `${fmtLen(p.length, p.units, { feet: true })} x ${fmtLen(p.width, p.units)} x ${fmtLen(p.thickness, p.units)}` +
    `<br>${core.frame.ribs.length} ribs, ${core.frame.longitudinals.reduce((a, l) => a + (l.y === 0 ? 1 : 2), 0)} spines, ${p.skinStrips} strips per side` +
    (core.frame.footBaseZ !== null
      ? `<br>standing on rib feet, ${fmtLen(p.footHeight, p.units)} clear`
      : s?.datumZ != null ? `<br>setup datum at ${fmtLen(s.datumZ, p.units)}` : '') +
    `<br>drag to orbit, scroll to zoom`
}

// ---------------------------------------------------------------- rebuild

let fullTimer = 0
let fastPending = false

function applyCore() {
  core = buildCore(params)
  viewer?.update(core)
  renderStats()
  renderHud()
}

function applyFull() {
  setStatus('generating...', 'busy')
  // let the browser paint the busy state before the synchronous build
  requestAnimationFrame(() => {
    try {
      model = buildModel(core)
      renderStats()
      renderHud()
      renderSheets()
      renderNotes()
      setStatus('up to date', '', 2200)
    } catch (err) {
      console.error(err)
      setStatus('generation failed, see the console', 'err')
    }
  })
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(params)) } catch { /* private mode, quota, whatever */ }
  writeUrl(params)
}

function change(patch: Partial<Params>, live: boolean) {
  params = sanitize({ ...params, ...patch })
  controls.markPreset(null)

  if (live) {
    // Dragging: rebuild the skeleton on the next frame and leave the sheets,
    // notes and persistence for when the slider settles.
    if (!fastPending) {
      fastPending = true
      requestAnimationFrame(() => { fastPending = false; applyCore() })
    }
    model = null
    setStatus('adjusting...', 'busy')
  } else {
    // sanitize may have clamped something, so push the real values back out
    controls.sync(params)
    persist()
    applyCore()
  }
  clearTimeout(fullTimer)
  fullTimer = window.setTimeout(() => { persist(); applyFull() }, live ? 260 : 0)
}

function usePreset(id: string) {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return
  params = sanitize({ ...DEFAULTS, ...preset.patch })
  controls.sync(params)
  controls.markPreset(id)
  persist()
  applyCore()
  clearTimeout(fullTimer)
  applyFull()
}

const controls = mountControls($('#sidebar'), () => params, change, usePreset)

// ---------------------------------------------------------------- tabs

const tabs = $('#tabs')
tabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button')
  if (!b) return
  const id = b.dataset.tab!
  for (const other of tabs.querySelectorAll('button')) other.classList.toggle('active', other === b)
  for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('active', pane.id === `pane-${id}`)
})

// ---------------------------------------------------------------- export

const exportBtn = $<HTMLButtonElement>('#btn-export')
exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true
  const original = exportBtn.textContent
  exportBtn.textContent = 'Packing...'
  setStatus('building the bundle, this takes a moment', 'busy')
  try {
    if (!model) model = buildModel(core)
    const { blob, name, fileCount } = await buildBundle(model)
    download(blob, name)
    setStatus(`${fileCount} files, ${(blob.size / 1048576).toFixed(1)} MB`, '', 6000)
  } catch (err) {
    console.error(err)
    setStatus('export failed, see the console', 'err')
  } finally {
    exportBtn.disabled = false
    exportBtn.textContent = original
  }
})

// ---------------------------------------------------------------- go

// a handle for poking at the generator from the console
;(window as unknown as Record<string, unknown>).sup = {
  get params() { return params },
  get core() { return core },
  get model() { return model },
  viewer,
  rebuild: () => { applyCore(); applyFull() },
}

controls.markPreset(
  PRESETS.find((p) => JSON.stringify(sanitize({ ...DEFAULTS, ...p.patch })) === JSON.stringify(params))?.id ?? null,
)
renderViewerTools()
applyCore()
applyFull()
