import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

function normalizeModel(model: THREE.Object3D, targetSize = 1.2): void {
  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = maxDim > 0 ? targetSize / maxDim : 1

  model.scale.setScalar(scale)
  model.position.set(
    -center.x * scale,
    -center.y * scale,
    -center.z * scale,
  )
}

export async function renderModelPreview(
  canvas: HTMLCanvasElement,
  glbUrl: string,
): Promise<void> {
  const size = canvas.width
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x141414)

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
  camera.position.set(0.9, 0.55, 1.6)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  scene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const key = new THREE.DirectionalLight(0xffffff, 1.3)
  key.position.set(2, 3, 2)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35)
  fill.position.set(-2, 0, 1)
  scene.add(fill)

  try {
    const gltf = await loader.loadAsync(glbUrl)
    normalizeModel(gltf.scene)
    scene.add(gltf.scene)
    renderer.render(scene, camera)
  } catch {
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#141414'
      ctx.fillRect(0, 0, size, size)
    }
  } finally {
    renderer.dispose()
  }
}
