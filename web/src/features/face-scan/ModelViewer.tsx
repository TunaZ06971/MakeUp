import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { FaceScan } from './scanModel'
import { download } from './scanModel'
import { UVLookup } from '../render-engine/uvLookup'
import type { PaintLayer, StrokePoint } from '../render-engine/paintLayer'
export interface ModelBrush {
  target: PaintLayer
  settings: { radius: number; flow: number }
}
// GPU material ownership is outside React; source canvases are never mutated here.
function updateCoating(material: THREE.MeshPhysicalMaterial, coating?: HTMLCanvasElement | null) {
    material.clearcoatMap?.dispose()
    const map = coating ? new THREE.CanvasTexture(coating) : null
    material.clearcoatMap = map
    material.clearcoatRoughnessMap = map
    material.clearcoat = map ? 1 : 0
    material.needsUpdate = true
}
export function ModelViewer({
  scan,
  texture,
  coating,
  brush,
  onStroke,
  onDirty,
  busy,
}: {
  scan: FaceScan
  busy: boolean
  texture: string | HTMLCanvasElement
  coating?: HTMLCanvasElement | null
  brush: ModelBrush | null
  onStroke: (p: StrokePoint[]) => void
  onDirty: () => void
}) {
  const { t } = useTranslation(),
    container = useRef<HTMLDivElement>(null)
  const engine = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    distance: number
  } | null>(null)
  const [wire, setWire] = useState(false),
    [move, setMove] = useState(false),
    [blink, setBlink] = useState(0),
    [mouth, setMouth] = useState(0),
    [failed, setFailed] = useState(false)
  const latest = useRef({ brush, onStroke, onDirty, move })
  useLayoutEffect(() => {
    latest.current = { brush, onStroke, onDirty, move }
  }, [brush, onStroke, onDirty, move])
  useEffect(() => {
    const host = container.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      })
    } catch {
      queueMicrotask(() => setFailed(true))
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#18151c')
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(scan.vertices, 3),
    )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(scan.uv, 2))
    geometry.setIndex(scan.triangles)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    if (Object.keys(scan.expressions).length)
      geometry.morphAttributes.position = Object.entries(scan.expressions).map(
        ([name, values]) => {
          const attribute = new THREE.Float32BufferAttribute(values, 3)
          attribute.name = name
          return attribute
        },
      )
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3()),
      size = geometry.boundingBox!.getSize(new THREE.Vector3())
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        specularIntensity: 0,
        roughness: 1,
        clearcoatRoughness: 1,
        side: THREE.FrontSide,
      }),
      mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'MakeUp face surface'
    mesh.userData = {
      source: scan.source,
      units: scan.units,
      surfaceOnly: true,
    }
    scene.add(mesh)
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-3, 4, 5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(4, 1, 3)
    scene.add(fill)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100)
    const distance = Math.max(size.y, size.x) * 1.85
    camera.position.copy(center).add(new THREE.Vector3(0, 0, distance))
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(center)
    controls.minDistance = distance * 0.3
    controls.maxDistance = distance * 3
    controls.enableDamping = true
    engine.current = { renderer, scene, mesh, camera, controls, distance }
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    let raf = 0,
      points: StrokePoint[] | null = null,
      previous: StrokePoint | null = null
    const lookups = scan.frames.map((f) =>
      f.landmarks
        ? new UVLookup(f.landmarks.map((p) => ({ ...p, visibility: 1 })))
        : null,
    )
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2()
    const uvAt = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      )
      ray.setFromCamera(pointer, camera)
      const hit = ray.intersectObject(mesh)[0]
      if (!hit?.face || hit.faceIndex == null) return null
      const f = hit.face
      const bary = THREE.Triangle.getBarycoord(
        hit.point,
        mesh.getVertexPosition(f.a, new THREE.Vector3()),
        mesh.getVertexPosition(f.b, new THREE.Vector3()),
        mesh.getVertexPosition(f.c, new THREE.Vector3()),
        new THREE.Vector3(),
      )
      if (!bary) return null
      const ranked = scan.frames
        .map((frame, i) => ({ frame, i, w: frame.weights[hit.faceIndex!] }))
        .sort((a, b) => b.w - a.w)
      for (const { frame, i } of ranked) {
        const projection = frame.projection
        const x =
            bary.x * projection[f.a * 2] +
            bary.y * projection[f.b * 2] +
            bary.z * projection[f.c * 2],
          y =
            bary.x * projection[f.a * 2 + 1] +
            bary.y * projection[f.b * 2 + 1] +
            bary.z * projection[f.c * 2 + 1]
        const uv = lookups[i]?.toUV(x, y)
        if (uv) return uv
      }
      return null
    }
    const paint = (event: PointerEvent) => {
      const target = latest.current.brush
      if (!target || !points) return
      const uv = uvAt(event)
      if (!uv) {
        previous = null
        return
      }
      const point = { u: uv.x, v: uv.y, startsSegment: previous === null }
      target.target.extendStroke(previous, point, target.settings.radius)
      points.push(point)
      previous = point
      latest.current.onDirty()
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !latest.current.brush || latest.current.move)
        return
      controls.enabled = false
      renderer.domElement.setPointerCapture(event.pointerId)
      points = []
      previous = null
      latest.current.brush.target.beginStroke(
        latest.current.brush.settings.flow,
      )
      paint(event)
    }
    const drag = (event: PointerEvent) => {
      if (points) paint(event)
    }
    const end = () => {
      if (points) {
        latest.current.brush?.target.endStroke()
        if (points.length) latest.current.onStroke(points)
        points = null
        previous = null
        latest.current.onDirty()
      }
      controls.enabled = true
    }
    const cancel = () => {
      if (points) {
        latest.current.brush?.target.cancelStroke()
        points = null
        previous = null
        latest.current.onDirty()
      }
      controls.enabled = true
    }
    renderer.domElement.addEventListener('pointerdown', down, true)
    renderer.domElement.addEventListener('pointermove', drag)
    renderer.domElement.addEventListener('pointerup', end)
    renderer.domElement.addEventListener('pointercancel', cancel)
    const render = () => {
      raf = requestAnimationFrame(render)
      controls.enabled = !latest.current.brush || latest.current.move
      controls.update()
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancel()
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      material.emissiveMap?.dispose()
      material.clearcoatMap?.dispose()
      material.dispose()
      geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      engine.current = null
    }
  }, [scan])
  useEffect(() => {
    const e = engine.current
    if (!e) return
    let cancelled = false
    const apply = (map: THREE.Texture) => {
      if (cancelled) {
        map.dispose()
        return
      }
      map.colorSpace = THREE.SRGBColorSpace
      e.mesh.material.emissiveMap?.dispose()
      e.mesh.material.emissiveMap = map
      e.mesh.material.needsUpdate = true
    }
    if (typeof texture === 'string')
      new THREE.TextureLoader().load(texture, apply, undefined, () =>
        setFailed(true),
      )
    else apply(new THREE.CanvasTexture(texture))
    return () => {
      cancelled = true
    }
  }, [texture, scan])
  useEffect(() => {
    const material = engine.current?.mesh.material
    if (!material) return
    updateCoating(material, coating)
  }, [coating, scan])
  useEffect(() => {
    const e = engine.current
    if (!e) return
    e.mesh.material.wireframe = wire
    if (e.mesh.morphTargetInfluences)
      for (const [name, index] of Object.entries(
        e.mesh.morphTargetDictionary ?? {},
      ))
        e.mesh.morphTargetInfluences[index] = name === 'blink' ? blink : mouth
  }, [wire, blink, mouth, scan])
  const orient = (angle: number) => {
    const e = engine.current
    if (!e) return
    e.camera.position
      .copy(e.controls.target)
      .add(
        new THREE.Vector3(
          Math.sin(angle) * e.distance,
          0,
          Math.cos(angle) * e.distance,
        ),
      )
    e.controls.update()
  }
  return (
    <>
      <div className="model-toolbar">
        <div className="viewport__group">
          <button className="tool" onClick={() => orient(-0.8)}>
            {t('scan.leftView')}
          </button>
          <button className="tool" onClick={() => orient(0)}>
            {t('scan.frontView')}
          </button>
          <button className="tool" onClick={() => orient(0.8)}>
            {t('scan.rightView')}
          </button>
          <button
            className="tool"
            aria-pressed={wire}
            onClick={() => setWire(!wire)}
          >
            {t('scan.wire')}
          </button>
          <button
            className="tool"
            aria-pressed={move}
            onClick={() => setMove(!move)}
          >
            {t('scan.rotate')}
          </button>
        </div>
        <button
          className="tool"
          disabled={busy}
          onClick={async () => {
            try {
              const e = engine.current
              if (!e) return
              const glb = await new GLTFExporter().parseAsync(e.mesh, {
                binary: true,
              })
              download(
                new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }),
                'MakeUp-face.glb',
              )
            } catch {
              setFailed(true)
            }
          }}
        >
          {t('scan.exportGLB')}
        </button>
      </div>
      <div
        ref={container}
        className="model-viewer"
        aria-label={t('scan.model')}
      />
      {failed && <p className="form__error">{t('scan.feedback.buildError')}</p>}
      <div className="model-expressions">
        <label>
          {t('scan.short.blink')}
          <input
            aria-label={t('scan.short.blink')}
            type="range"
            min="0"
            max="1"
            step=".01"
            value={blink}
            disabled={!scan.expressions.blink}
            onChange={(e) => setBlink(+e.target.value)}
          />
        </label>
        <label>
          {t('scan.short.mouth')}
          <input
            aria-label={t('scan.short.mouth')}
            type="range"
            min="0"
            max="1"
            step=".01"
            value={mouth}
            disabled={!scan.expressions.mouth}
            onChange={(e) => setMouth(+e.target.value)}
          />
        </label>
      </div>
    </>
  )
}
