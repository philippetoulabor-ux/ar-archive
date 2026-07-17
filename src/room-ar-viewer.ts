import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  drawFrozenPreview,
  drawImageCover,
  EXPORT_JPEG_QUALITY,
  getCaptureOutputSize,
  releaseCanvas,
  MAX_CAPTURE_EDGE,
  type FrozenBackground,
} from './capture.ts'
import { disposeObject3D } from './dispose-object3d.ts'
import { patchArMaterials } from './material-patches.ts'

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
  /** Bumped on each loadModel/cleanup so late GLTF callbacks are ignored. */
  private loadGeneration = 0
  private placed = false
  private onLoading?: (progress: number) => void
  private onModelLoaded?: () => void
  private onPlaced?: () => void
  private onError?: (message: string) => void
  private onSessionEnded?: () => void
  private onSelectBound: () => void
  private onSessionEndBound: () => void
  private onSessionStartBound: () => void
  private cleanedUp = false

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
    const generation = ++this.loadGeneration
    this.clearCurrentModel()

    this.placed = false
    this.reticle.visible = false

    this.loader.load(
      url,
      (gltf) => {
        if (generation !== this.loadGeneration) {
          disposeObject3D(gltf.scene)
          return
        }

        const model = gltf.scene
        patchArMaterials(model)
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
        if (generation !== this.loadGeneration) return
        if (event.lengthComputable) {
          this.onLoading?.(Math.round((event.loaded / event.total) * 100))
        } else {
          this.onLoading?.(50)
        }
      },
      () => {
        if (generation !== this.loadGeneration) return
        this.onError?.('Modell konnte nicht geladen werden.')
      },
    )
  }

  private clearCurrentModel(): void {
    if (!this.currentModel) return
    this.modelRoot.remove(this.currentModel)
    disposeObject3D(this.currentModel)
    this.currentModel = null
  }

  isPlaced(): boolean {
    return this.placed
  }

  isBackgroundFrozen(): boolean {
    return this.frozen
  }

  /** Capture current XR frame as photo background (passthrough quality limited). */
  async takePhoto(): Promise<void> {
    this.renderer.render(this.scene, this.camera)
    const canvas = this.renderer.domElement
    if (canvas.width < 1 || canvas.height < 1) {
      throw new Error('XR-Frame nicht verfügbar')
    }

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = canvas.width
    sourceCanvas.height = canvas.height
    const ctx = sourceCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D nicht verfügbar')
    }
    ctx.drawImage(canvas, 0, 0)

    if (this.frozenBackground) {
      releaseCanvas(this.frozenBackground.canvas)
    }

    const viewportWidth = this.stage.clientWidth || canvas.width
    const viewportHeight = this.stage.clientHeight || canvas.height

    this.frozenBackground = {
      canvas: sourceCanvas,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      viewportWidth,
      viewportHeight,
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    drawFrozenPreview(
      this.frozenBg,
      sourceCanvas,
      Math.max(1, Math.round(viewportWidth * dpr)),
      Math.max(1, Math.round(viewportHeight * dpr)),
    )
    this.frozenBg.classList.remove('hidden')
    this.frozen = true
  }

  freezeBackground(): void {
    void this.takePhoto().catch((error) => {
      console.error('takePhoto failed:', error)
      this.onError?.(
        error instanceof Error ? error.message : 'Foto fehlgeschlagen',
      )
    })
  }

  async captureComposite(): Promise<Blob> {
    if (!this.frozen || !this.frozenBackground) {
      throw new Error('Kein Foto vorhanden')
    }

    this.renderer.render(this.scene, this.camera)
    const source = this.renderer.domElement
    if (source.width < 1 || source.height < 1) {
      throw new Error('XR-Frame nicht verfügbar')
    }

    const { width, height } = getCaptureOutputSize(
      this.frozenBackground.viewportWidth,
      this.frozenBackground.viewportHeight,
      source.width,
      source.height,
      MAX_CAPTURE_EDGE,
    )

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = width
    exportCanvas.height = height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D nicht verfügbar')
    }
    drawImageCover(ctx, source, width, height)

    return new Promise((resolve, reject) => {
      exportCanvas.toBlob(
        (blob) => {
          releaseCanvas(exportCanvas)
          if (blob) resolve(blob)
          else reject(new Error('Export fehlgeschlagen'))
        },
        'image/jpeg',
        EXPORT_JPEG_QUALITY,
      )
    })
  }

  unfreeze(): void {
    this.frozenBg.classList.add('hidden')
    if (this.frozenBackground) {
      releaseCanvas(this.frozenBackground.canvas)
      this.frozenBackground = null
    }
    releaseCanvas(this.frozenBg)
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
    if (this.cleanedUp) return
    this.cleanedUp = true
    this.loadGeneration += 1
    this.renderer.setAnimationLoop(null)
    this.renderer.xr.removeEventListener('sessionstart', this.onSessionStartBound)
    this.hitTestSource = null
    this.referenceSpace = null
    this.placed = false
    this.unfreeze()
    this.clearCurrentModel()
    this.modelRoot.clear()
    disposeObject3D(this.reticle)
    this.scene.remove(this.reticle)
    this.frozenBg.remove()
    this.renderer.domElement.remove()
    this.renderer.dispose()
  }
}
