import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CoreModel } from '../model'
import { extrudePoly, hullMesh, Mesh, placeRib, plankMesh, transformMesh } from '../geom/mesh'

export interface ViewOptions {
  skin: boolean
  frame: boolean
  plank: boolean
  cradle: boolean
  cutaway: boolean
}

export const DEFAULT_VIEW: ViewOptions = { skin: true, frame: true, plank: true, cradle: false, cutaway: true }

/**
 * Can this browser actually give us a 3D context?
 *
 * Worth asking before three.js tries, because when context creation fails its
 * own error path throws a second, meaningless error over the top of the real
 * one, and the real reason is the useful part.
 */
export function webglSupport(): { ok: true } | { ok: false; reason: string } {
  try {
    const probe = document.createElement('canvas')
    const gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) {
      return {
        ok: false,
        reason: 'This browser would not give the page a WebGL context. That usually means hardware acceleration is switched off, or the page is running inside an embedded browser view that blocks it.',
      }
    }
    const lost = gl.getExtension('WEBGL_lose_context')
    lost?.loseContext()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `WebGL threw while starting up: ${(err as Error).message}` }
  }
}

function toGeometry(m: Mesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m, 3))
  g.computeVertexNormals()
  return g
}

export class Viewer {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  /** Board space is x along, y across, z up. This group rotates it to three's y up. */
  private board = new THREE.Group()
  private skinGroup = new THREE.Group()
  private frameGroup = new THREE.Group()
  private plankGroup = new THREE.Group()
  private cradleGroup = new THREE.Group()
  private grid: THREE.GridHelper
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private opts: ViewOptions = { ...DEFAULT_VIEW }
  private lastFitKey = ''
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  private raf = 0

  private matSkin: THREE.MeshPhysicalMaterial
  private matFrame: THREE.MeshStandardMaterial
  private matCradle: THREE.MeshStandardMaterial
  private matPlank: THREE.MeshStandardMaterial

  constructor(private canvas: HTMLCanvasElement, private onContextLost?: (reason: string) => void) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    } catch (err) {
      throw new Error(`WebGL could not start: ${(err as Error).message}`)
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.localClippingEnabled = true
    this.scene.background = new THREE.Color(0x10141a)
    this.scene.fog = new THREE.Fog(0x10141a, 4000, 16000)

    this.camera = new THREE.PerspectiveCamera(38, 1, 10, 40000)
    this.camera.position.set(2200, 1500, 2600)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.92

    this.scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x2a2118, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(1200, 2000, 1400)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x88b8ff, 0.7)
    fill.position.set(-1500, 600, -1200)
    this.scene.add(fill)

    this.grid = new THREE.GridHelper(8000, 40, 0x38424f, 0x232a34)
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.5
    this.scene.add(this.grid)

    this.matSkin = new THREE.MeshPhysicalMaterial({
      color: 0x7fd4f5, transparent: true, opacity: 0.16, roughness: 0.25, metalness: 0,
      side: THREE.DoubleSide, depthWrite: false, transmission: 0.2, clearcoat: 0.6,
    })
    this.matFrame = new THREE.MeshStandardMaterial({ color: 0xd8b184, roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide })
    this.matCradle = new THREE.MeshStandardMaterial({ color: 0x5a6b7a, roughness: 0.9, side: THREE.DoubleSide })
    // a warmer, darker wood than the frame, so the rail reads apart from it
    this.matPlank = new THREE.MeshStandardMaterial({ color: 0xa8703c, roughness: 0.6, metalness: 0.02, side: THREE.DoubleSide })

    this.board.rotation.x = -Math.PI / 2 // board z becomes three y
    this.board.add(this.skinGroup, this.frameGroup, this.plankGroup, this.cradleGroup)
    this.scene.add(this.board)

    // A context can also go away later, when a driver resets or the tab is
    // moved between GPUs. Say so rather than freezing on the last frame.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      cancelAnimationFrame(this.raf)
      this.onContextLost?.('The browser took the WebGL context away, usually after a graphics driver reset.')
    })

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas)
    this.resize()
    this.loop()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.clear()
    this.renderer.dispose()
  }

  private resize() {
    const p = this.canvas.parentElement
    const w = p?.clientWidth || 1
    const h = p?.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private clear() {
    for (const g of [this.skinGroup, this.frameGroup, this.plankGroup, this.cradleGroup]) {
      for (const child of [...g.children]) g.remove(child)
    }
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  setOptions(o: Partial<ViewOptions>) {
    this.opts = { ...this.opts, ...o }
    this.skinGroup.visible = this.opts.skin
    this.frameGroup.visible = this.opts.frame
    this.plankGroup.visible = this.opts.plank
    this.cradleGroup.visible = this.opts.cradle
    this.matSkin.clippingPlanes = this.opts.cutaway ? [this.clip] : []
    this.matSkin.needsUpdate = true
  }

  getOptions(): ViewOptions { return { ...this.opts } }

  /** Debug snapshot of what is actually in the scene. */
  describe() {
    const count = (g: THREE.Group) => g.children.reduce((a, c) => a + (((c as THREE.Mesh).geometry?.getAttribute('position')?.count ?? 0) / 3), 0)
    const box = new THREE.Box3().setFromObject(this.board)
    return {
      skinTris: count(this.skinGroup), frameTris: count(this.frameGroup),
      plankTris: count(this.plankGroup), cradleTris: count(this.cradleGroup),
      visible: {
        skin: this.skinGroup.visible, frame: this.frameGroup.visible,
        plank: this.plankGroup.visible, cradle: this.cradleGroup.visible,
      },
      boardBox: box.isEmpty() ? null : { min: box.min.toArray().map(Math.round), max: box.max.toArray().map(Math.round) },
      camera: this.camera.position.toArray().map(Math.round),
      target: this.controls.target.toArray().map(Math.round),
    }
  }

  update(m: CoreModel) {
    this.clear()
    const p = m.params

    const add = (group: THREE.Group, mesh: Mesh, mat: THREE.Material) => {
      const g = toGeometry(mesh)
      this.disposables.push(g)
      group.add(new THREE.Mesh(g, mat))
    }

    add(this.skinGroup, hullMesh(m.hull, 121, 26), this.matSkin)

    const rail = plankMesh(m.hull, m.frame.stations, 161, 26)
    if (rail.length) add(this.plankGroup, rail, this.matPlank)

    const frameTris: Mesh[] = []
    for (const rib of m.frame.ribs) frameTris.push(placeRib(extrudePoly(rib.poly, rib.thickness), rib.station!, rib.thickness))
    for (const st of m.frame.stringers) {
      const y = st.offsetY ?? 0
      // a spine off the centreline is one part used on both sides
      for (const side of y === 0 ? [0] : [y, -y]) {
        frameTris.push(
          transformMesh(extrudePoly(st.poly, st.thickness), (lx, ly, lz) => [lx, side - st.thickness / 2 + lz, ly]),
        )
      }
    }
    for (const t of frameTris) add(this.frameGroup, t, this.matFrame)

    // the cradle sits either side of the centreline, mirrored
    for (const jig of m.jigParts) {
      const flat = extrudePoly(jig.poly, jig.thickness)
      for (const side of [1, -1] as const) {
        const off = side * (p.plyThickness / 2 + p.partSpacing / 2 + jig.thickness / 2)
        add(this.cradleGroup, transformMesh(flat, (lx, ly, lz) => [lx, off - jig.thickness / 2 + lz, ly]), this.matCradle)
      }
    }

    // centre the board over the origin and drop it onto the grid
    this.board.position.set(0, 0, 0)
    this.skinGroup.position.set(-p.length / 2, 0, 0)
    this.frameGroup.position.set(-p.length / 2, 0, 0)
    this.plankGroup.position.set(-p.length / 2, 0, 0)
    this.cradleGroup.position.set(-p.length / 2, 0, 0)
    // with feet the board really does stand on a bench, so put the grid there
    this.grid.position.y = m.frame.footBaseZ !== null ? m.frame.footBaseZ : -2

    const fitKey = `${p.length}|${p.width}|${p.thickness}`
    if (fitKey !== this.lastFitKey) {
      this.lastFitKey = fitKey
      this.fit(p.length)
    }
    this.setOptions({})
  }

  fit(length: number) {
    const d = length * 0.95
    this.camera.position.set(d * 0.55, d * 0.42, d * 0.72)
    this.controls.target.set(0, length * 0.02, 0)
    this.controls.update()
  }

  setView(kind: 'iso' | 'side' | 'top' | 'front', length: number) {
    const d = length * 0.95
    const t = new THREE.Vector3(0, length * 0.02, 0)
    const pos: Record<string, [number, number, number]> = {
      iso: [d * 0.55, d * 0.42, d * 0.72],
      side: [0, length * 0.02, d * 1.05],
      top: [0, d * 1.0, 0.001],
      front: [d * 1.0, length * 0.02, 0],
    }
    this.camera.position.set(...pos[kind])
    this.controls.target.copy(t)
    this.controls.update()
  }
}
