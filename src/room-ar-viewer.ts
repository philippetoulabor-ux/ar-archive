import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { compositeHighRes, drawFrozenPreview, getCaptureOutputSize, type FrozenBackground } from './capture.ts'

export interface RoomARViewerOptions {
  stage: HTMLElement
  domOverlayRoot: HTMLElement
  onLoading?: (progress: number) => void
  onModelLoaded?: () => void
  onPlaced?: () => void
  onError?: (message: string) => void
  onSessionEnded?: () => void
}

export class RoomARViewer {
  private stage: HTMLElement
  private domOverlayRoot: HTMLElement
  private frozenBg: HTMLCanvasElement
  private frozenBackground: FrozenBackground | null = null
  private frozen = false
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private loader: GLTFLoader
  private reticle: THREE.Mesh
  private modelRoot: THREE.Group
  private hitTestSource: XRHitTestSource | null = null
  private referenceSpace: XRReferenceSpace | null = null
  private currentModel: THREE.Object3D | null = null
  private placed = false
  private onLoading?: (progress: number) => void
  private onModelLoaded?: () => void
  private onPlaced?: () => void
  private onError?: (message: string) => void
  private onSessionEnded?: () => void
  private onSelectBound: () => void
  private onSessionEndBound: () => void
  private onSessionStartBound: () => void

  constructor(options: RoomARViewerOptions) {
    this.stage = options.stage
    this.domOverlayRoot = options.domOverlayRoot
    this.onLoading = options.onLoading
    this.onModelLoaded = options.onModelLoaded
    this.onPlaced = options.onPlaced
    this.onError = options.onError
    this.onSessionEnded = options.onSessionEnded

    this.onSelectBound = this.onSelect
    this.onSessionEndBound = () => {
      this.cleanup()
      this.onSessionEnded?.()
    }
    this.onSessionStartBound = () => {
      void this.initHitTest()
    }

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20)

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.xr.enabled = true
    this.renderer.domElement.className = 'ar-canvas'

    this.frozenBg = document.createElement('canvas')
    this.frozenBg.className = 'ar-frozen-bg hidden'

    const loading = this.stage.querySelector('.loading-overlay')
    if (loading) {
      this.stage.insertBefore(this.frozenBg, loading)
      this.stage.insertBefore(this.renderer.domElement, loading)
    } else {
      this.stage.append(this.frozenBg, this.renderer.domElement)
    }

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1.2)
    this.scene.add(light)

    const reticleGeo = new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2)
    this.reticle = new THREE.Mesh(
      reticleGeo,
      new THREE.MeshBasicMaterial({
        color: 0x5b8cff,
        transparent: true,
        opacity: 0.9,
      }),
    )
    this.reticle.matrixAutoUpdate = false
    this.reticle.visible = false
    this.scene.add(this.reticle)

    this.modelRoot = new THREE.Group()
    this.scene.add(this.modelRoot)

    const controller = this.renderer.xr.getController(0)
    controller.addEventListener('select', this.onSelectBound)
    this.scene.add(controller)

    this.loader = new GLTFLoader()
  }

  async start(): Promise<void> {
    if (!navigator.xr) {
      throw new Error('WebXR nicht verfügbar')
    }

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: this.domOverlayRoot },
    })

    await this.renderer.xr.setSession(session)

    session.addEventListener('end', this.onSessionEndBound)
    this.renderer.xr.addEventListener('sessionstart', this.onSessionStartBound)
    this.renderer.setAnimationLoop(this.onFrame)
  }

  loadModel(url: string): void {
    if (this.currentModel) {
      this.modelRoot.remove(this.currentModel)
      this.currentModel = null
    }

    this.placed = false
    this.reticle.visible = false

    this.loader.load(
      url,
      (gltf) => {
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 0.6 / maxDim : 1

        model.scale.setScalar(scale)
        model.position.set(
          -center.x * scale,
          -center.y * scale,
          -center.z * scale,
        )
        model.visible = false

        this.currentModel = model
        this.modelRoot.add(model)
        this.onLoading?.(100)
        this.onModelLoaded?.()
      },
      (event) => {
        if (event.lengthComputable) {
          this.onLoading?.(Math.round((event.loaded / event.total) * 100))
        } else {
          this.onLoading?.(50)
        }
      },
      () => this.onError?.('Modell konnte nicht geladen werden.'),
    )
  }

  isPlaced(): boolean {
    return this.placed
  }

  isBackgroundFrozen(): boolean {
    return this.frozen
  }

  freezeBackground(): void {
    this.renderer.render(this.scene, this.camera)
    const canvas = this.renderer.domElement

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = canvas.width
    sourceCanvas.height = canvas.height
    const ctx = sourceCanvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, 0, 0)

    this.frozenBackground = {
      canvas: sourceCanvas,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      viewportWidth: canvas.width,
      viewportHeight: canvas.height,
    }

    drawFrozenPreview(
      this.frozenBg,
      sourceCanvas,
      canvas.width,
      canvas.height,
    )
    this.frozenBg.classList.remove('hidden')
    this.frozen = true
  }

  async captureComposite(): Promise<Blob> {
    if (!this.frozen || !this.frozenBackground) {
      throw new Error('Hintergrund ist nicht eingefroren')
    }

    this.renderer.render(this.scene, this.camera)

    const { width, height } = getCaptureOutputSize(
      this.frozenBackground.viewportWidth,
      this.frozenBackground.viewportHeight,
      this.frozenBackground.sourceWidth,
      this.frozenBackground.sourceHeight,
    )

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = width
    exportCanvas.height = height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D nicht verfügbar')
    }
    ctx.drawImage(this.renderer.domElement, 0, 0, width, height)

    try {
      return await compositeHighRes(this.frozenBackground, exportCanvas)
    } finally {
      exportCanvas.remove()
    }
  }

  unfreeze(): void {
    this.frozenBg.classList.add('hidden')
    this.frozenBackground = null
    this.frozen = false
  }

  destroy(): void {
    const session = this.renderer.xr.getSession()
    if (session) {
      session.removeEventListener('end', this.onSessionEndBound)
      void session.end()
    }
    this.cleanup()
  }

  private async initHitTest(): Promise<void> {
    const session = this.renderer.xr.getSession()
    if (!session?.requestHitTestSource) return

    try {
      const viewerSpace = await session.requestReferenceSpace('viewer')
      this.referenceSpace = await session.requestReferenceSpace('local')
      this.hitTestSource =
        (await session.requestHitTestSource({ space: viewerSpace })) ?? null
    } catch {
      this.onError?.('Bodenerkennung nicht verfügbar')
    }
  }

  private onSelect = (): void => {
    if (!this.currentModel || !this.reticle.visible || this.placed) return

    this.modelRoot.position.setFromMatrixPosition(this.reticle.matrix)
    this.modelRoot.quaternion.setFromRotationMatrix(this.reticle.matrix)
    this.currentModel.visible = true
    this.placed = true
    this.reticle.visible = false
    this.onPlaced?.()
  }

  private onFrame = (_time: number, frame: XRFrame | undefined): void => {
    if (frame && this.hitTestSource && this.referenceSpace && !this.placed) {
      const hits = frame.getHitTestResults(this.hitTestSource)
      if (hits.length > 0) {
        const pose = hits[0]!.getPose(this.referenceSpace)
        if (pose) {
          this.reticle.visible = true
          this.reticle.matrix.fromArray(pose.transform.matrix)
        }
      } else {
        this.reticle.visible = false
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  private cleanup(): void {
    this.renderer.setAnimationLoop(null)
    this.renderer.xr.removeEventListener('sessionstart', this.onSessionStartBound)
    this.hitTestSource = null
    this.referenceSpace = null
    this.placed = false
    this.currentModel = null
    this.modelRoot.clear()
    this.frozenBg.remove()
    this.renderer.domElement.remove()
    this.renderer.dispose()
  }
}
