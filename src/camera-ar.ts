import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { compositeHighRes, captureVideoFrameSync, captureHiResPhoto, drawFrozenPreview, getCaptureOutputSize, type FrozenBackground } from './capture.ts'
import { patchArMaterials } from './material-patches.ts'

export interface CameraAROptions {
  container: HTMLElement
  onModelLoaded?: () => void
  onError?: (message: string) => void
  onLoading?: (progress: number) => void
}

export class CameraARViewer {
  private container: HTMLElement
  private video: HTMLVideoElement
  private frozenBg: HTMLCanvasElement
  private frozenBackground: FrozenBackground | null = null
  private exportRenderer: THREE.WebGLRenderer | null = null
  private exportSize = { width: 0, height: 0 }
  private hiResUpgradeId = 0
  private canvas: HTMLCanvasElement
  private videoTrack: MediaStreamTrack | null = null
  private frozen = false
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private modelGroup: THREE.Group
  private loader: GLTFLoader
  private animationId = 0
  private currentModel: THREE.Object3D | null = null
  private resizeObserver: ResizeObserver
  private onModelLoaded?: () => void
  private onError?: (message: string) => void
  private onLoading?: (progress: number) => void

  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStartDistance = 0
  private pinchStartScale = 1
  private dragStart = { x: 0, y: 0, modelX: 0, modelY: 0 }
  private rotateStart = { angle: 0, rotationY: 0 }
  private isDragging = false

  constructor(options: CameraAROptions) {
    this.container = options.container
    this.onModelLoaded = options.onModelLoaded
    this.onError = options.onError
    this.onLoading = options.onLoading

    this.video = document.createElement('video')
    this.video.setAttribute('playsinline', '')
    this.video.setAttribute('webkit-playsinline', '')
    this.video.muted = true
    this.video.autoplay = true
    this.video.className = 'ar-video'

    this.frozenBg = document.createElement('canvas')
    this.frozenBg.className = 'ar-frozen-bg hidden'

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ar-canvas'

    // Video & Canvas vor Loading-Overlay (z-index in CSS)
    const loading = this.container.querySelector('.loading-overlay')
    if (loading) {
      this.container.insertBefore(this.video, loading)
      this.container.insertBefore(this.frozenBg, loading)
      this.container.insertBefore(this.canvas, loading)
    } else {
      this.container.append(this.video, this.frozenBg, this.canvas)
    }

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100)
    this.camera.position.set(0, 0, 2.5)

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)

    const ambient = new THREE.AmbientLight(0xffffff, 1.0)
    const directional = new THREE.DirectionalLight(0xffffff, 1.4)
    directional.position.set(2, 4, 3)
    this.scene.add(ambient, directional)

    this.modelGroup = new THREE.Group()
    this.applyDefaultModelPosition()
    this.scene.add(this.modelGroup)

    this.loader = new GLTFLoader()

    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
      this.fitVideo()
    })
    this.resizeObserver.observe(this.container)
    window.addEventListener('resize', this.resize)

    this.bindEvents()
    requestAnimationFrame(() => this.resize())
  }

  async start(): Promise<void> {
    await this.startCamera()
    this.renderLoop()
  }

  private async startCamera(): Promise<void> {
    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      },
      {
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      },
    ]

    let stream: MediaStream | null = null
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch {
        /* try next constraint set */
      }
    }

    if (!stream) {
      throw new Error('Kamera nicht verfügbar')
    }

    this.videoTrack = stream.getVideoTracks()[0] ?? null
    this.video.srcObject = stream
    await this.video.play()

    await new Promise<void>((resolve) => {
      if (this.video.videoWidth > 0) {
        this.fitVideo()
        resolve()
        return
      }
      this.video.addEventListener(
        'loadedmetadata',
        () => {
          this.fitVideo()
          resolve()
        },
        { once: true },
      )
    })
  }

  /** Kamerabild füllt den Viewport (object-fit: cover). */
  private fitVideo(): void {
    this.video.style.objectFit = 'cover'
    this.video.style.objectPosition = 'center'
    this.video.style.transform = 'none'
  }

  loadModel(url: string): void {
    if (this.currentModel) {
      this.modelGroup.remove(this.currentModel)
      this.currentModel = null
    }

    this.modelGroup.scale.setScalar(1)
    this.applyDefaultModelPosition()
    this.modelGroup.rotation.set(0, 0, 0)

    this.loader.load(
      url,
      (gltf) => {
        const model = gltf.scene
        patchArMaterials(model)
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 1.0 / maxDim : 1

        model.scale.setScalar(scale)
        model.position.set(
          -center.x * scale,
          -center.y * scale,
          -center.z * scale,
        )

        this.currentModel = model
        this.modelGroup.add(model)
        requestAnimationFrame(() => this.applyDefaultModelPosition())
        this.onLoading?.(100)
        this.onModelLoaded?.()
      },
      (event) => {
        if (event.lengthComputable) {
          this.onLoading?.(
            Math.round((event.loaded / event.total) * 100),
          )
        } else {
          this.onLoading?.(50)
        }
      },
      (error) => {
        console.error('GLB load error:', error)
        this.onError?.('Modell konnte nicht geladen werden.')
      },
    )
  }

  isBackgroundFrozen(): boolean {
    return this.frozen
  }

  freezeBackground(): void {
    const viewportWidth = this.canvas.width
    const viewportHeight = this.canvas.height
    if (viewportWidth < 1 || viewportHeight < 1) return

    const sourceCanvas = captureVideoFrameSync(this.video)

    this.frozenBackground = {
      canvas: sourceCanvas,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      viewportWidth,
      viewportHeight,
    }

    drawFrozenPreview(this.frozenBg, sourceCanvas, viewportWidth, viewportHeight)
    this.frozenBg.classList.remove('hidden')
    this.video.classList.add('hidden')
    this.frozen = true

    this.warmExportRenderer()

    const track =
      this.videoTrack ??
      (this.video.srcObject instanceof MediaStream
        ? this.video.srcObject.getVideoTracks()[0]
        : null)
    if (track) {
      const upgradeId = ++this.hiResUpgradeId
      void this.upgradeToHiResPhoto(track, upgradeId)
    }
  }

  private async upgradeToHiResPhoto(
    track: MediaStreamTrack,
    upgradeId: number,
  ): Promise<void> {
    const hiRes = await captureHiResPhoto(track)
    if (!hiRes || !this.frozen || !this.frozenBackground) return
    if (upgradeId !== this.hiResUpgradeId) return

    this.frozenBackground = {
      ...this.frozenBackground,
      canvas: hiRes,
      sourceWidth: hiRes.width,
      sourceHeight: hiRes.height,
    }
    this.warmExportRenderer()
  }

  private warmExportRenderer(): void {
    if (!this.frozenBackground) return

    const { width, height } = getCaptureOutputSize(
      this.frozenBackground.viewportWidth,
      this.frozenBackground.viewportHeight,
      this.frozenBackground.sourceWidth,
      this.frozenBackground.sourceHeight,
    )

    requestAnimationFrame(() => {
      if (!this.frozen || !this.frozenBackground) return
      this.renderModelExport(width, height)
    })
  }

  async captureComposite(): Promise<Blob> {
    if (!this.frozen || !this.frozenBackground) {
      throw new Error('Hintergrund ist nicht eingefroren')
    }

    const { width, height } = getCaptureOutputSize(
      this.frozenBackground.viewportWidth,
      this.frozenBackground.viewportHeight,
      this.frozenBackground.sourceWidth,
      this.frozenBackground.sourceHeight,
    )

    const foreground = this.renderModelExport(width, height)
    return compositeHighRes(this.frozenBackground, foreground)
  }

  private renderModelExport(
    outputWidth: number,
    outputHeight: number,
  ): HTMLCanvasElement {
    if (
      !this.exportRenderer ||
      this.exportSize.width !== outputWidth ||
      this.exportSize.height !== outputHeight
    ) {
      this.exportRenderer?.dispose()
      const exportCanvas = document.createElement('canvas')
      this.exportRenderer = new THREE.WebGLRenderer({
        canvas: exportCanvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      })
      this.exportRenderer.setPixelRatio(1)
      this.exportRenderer.outputColorSpace = THREE.SRGBColorSpace
      this.exportRenderer.setClearColor(0x000000, 0)
      this.exportSize = { width: outputWidth, height: outputHeight }
      this.exportRenderer.setSize(outputWidth, outputHeight, false)
    }

    const cssWidth = this.container.clientWidth
    const cssHeight = this.container.clientHeight
    this.camera.aspect = cssWidth / cssHeight
    this.camera.updateProjectionMatrix()

    this.exportRenderer.render(this.scene, this.camera)
    return this.exportRenderer.domElement
  }

  unfreeze(): void {
    this.hiResUpgradeId++
    this.frozenBg.classList.add('hidden')
    this.frozenBackground = null
    this.video.classList.remove('hidden')
    this.frozen = false
  }

  destroy(): void {
    cancelAnimationFrame(this.animationId)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resize)
    const stream = this.video.srcObject
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    this.renderer.dispose()
    this.exportRenderer?.dispose()
    this.video.remove()
    this.frozenBg.remove()
    this.canvas.remove()
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
  }

  private applyDefaultModelPosition(): void {
    this.modelGroup.position.set(0, 0, 0)
  }

  private resize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width < 1 || height < 1) return

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private renderLoop = (): void => {
    this.animationId = requestAnimationFrame(this.renderLoop)
    this.renderer.render(this.scene, this.camera)
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 1) {
      this.isDragging = true
      this.dragStart = {
        x: event.clientX,
        y: event.clientY,
        modelX: this.modelGroup.position.x,
        modelY: this.modelGroup.position.y,
      }
    }

    if (this.pointers.size === 2) {
      this.isDragging = false
      this.pinchStartDistance = this.getPinchDistance()
      this.pinchStartScale = this.modelGroup.scale.x
      this.rotateStart = {
        angle: this.getPinchAngle(),
        rotationY: this.modelGroup.rotation.y,
      }
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 1 && this.isDragging) {
      const dx = (event.clientX - this.dragStart.x) / this.container.clientWidth
      const dy = (event.clientY - this.dragStart.y) / this.container.clientHeight
      this.modelGroup.position.x = this.dragStart.modelX + dx * 2.5
      this.modelGroup.position.y = this.dragStart.modelY - dy * 2.5
    }

    if (this.pointers.size === 2) {
      const distance = this.getPinchDistance()
      if (this.pinchStartDistance > 0) {
        const scale = this.pinchStartScale * (distance / this.pinchStartDistance)
        this.modelGroup.scale.setScalar(THREE.MathUtils.clamp(scale, 0.2, 4))
      }
      const angle = this.getPinchAngle()
      this.modelGroup.rotation.y =
        this.rotateStart.rotationY + (angle - this.rotateStart.angle)
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId)
    if (this.pointers.size < 2) {
      this.pinchStartDistance = 0
    }
    if (this.pointers.size === 0) {
      this.isDragging = false
    }
    if (this.pointers.size === 1) {
      const remaining = [...this.pointers.values()][0]!
      this.isDragging = true
      this.dragStart = {
        x: remaining.x,
        y: remaining.y,
        modelX: this.modelGroup.position.x,
        modelY: this.modelGroup.position.y,
      }
    }
  }

  private getPinchDistance(): number {
    const points = [...this.pointers.values()]
    if (points.length < 2) return 0
    const dx = points[1]!.x - points[0]!.x
    const dy = points[1]!.y - points[0]!.y
    return Math.hypot(dx, dy)
  }

  private getPinchAngle(): number {
    const points = [...this.pointers.values()]
    if (points.length < 2) return 0
    return Math.atan2(
      points[1]!.y - points[0]!.y,
      points[1]!.x - points[0]!.x,
    )
  }
}
