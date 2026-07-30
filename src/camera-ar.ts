import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  captureVideoFrameSync,
  compositeHighRes,
  drawFrozenPreview,
  getCaptureOutputSize,
  getRecommendedCaptureEdge,
  releaseCanvas,
  type FrozenBackground,
} from './capture.ts'
import { disposeObject3D } from './dispose-object3d.ts'
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
  private canvas: HTMLCanvasElement
  private frozen = false
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private modelGroup: THREE.Group
  private loader: GLTFLoader
  private animationId = 0
  private currentModel: THREE.Object3D | null = null
  /** Bumped on each loadModel/destroy so late GLTF callbacks are ignored. */
  private loadGeneration = 0
  private resizeObserver: ResizeObserver
  private onModelLoaded?: () => void
  private onError?: (message: string) => void
  private onLoading?: (progress: number) => void
  private maxCaptureEdge: number

  private pointers = new Map<number, { x: number; y: number }>()
  /** Single-finger / primary-button: free tumble. Two-finger: pan + pinch. */
  private gesture: 'none' | 'rotate' | 'pinch' = 'none'
  private lastPointer = { x: 0, y: 0 }
  private pinchStart = {
    distance: 0,
    scale: 1,
    midX: 0,
    midY: 0,
    modelX: 0,
    modelY: 0,
  }
  private readonly _qYaw = new THREE.Quaternion()
  private readonly _qPitch = new THREE.Quaternion()
  private readonly _axisX = new THREE.Vector3(1, 0, 0)
  private readonly _axisY = new THREE.Vector3(0, 1, 0)
  private renderRunning = false
  private cameraTracksEnabled = true

  /** Radians of rotation per full viewport width/height of drag. */
  private static readonly ROTATE_SPEED = Math.PI * 1.35
  /** World units of pan per full viewport width/height of two-finger drag. */
  private static readonly PAN_SPEED = 2.5

  constructor(options: CameraAROptions) {
    this.container = options.container
    this.onModelLoaded = options.onModelLoaded
    this.onError = options.onError
    this.onLoading = options.onLoading
    this.maxCaptureEdge = getRecommendedCaptureEdge()

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
      if (this.frozen && this.frozenBackground) {
        this.redrawFrozenPreview()
      }
    })
    this.resizeObserver.observe(this.container)
    window.addEventListener('resize', this.resize)

    this.bindEvents()
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    requestAnimationFrame(() => this.resize())
  }

  async start(): Promise<void> {
    await this.startCamera()
    this.syncMediaState()
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

  private fitVideo(): void {
    this.video.style.objectFit = 'cover'
    this.video.style.objectPosition = 'center'
    this.video.style.transform = 'none'
  }

  loadModel(url: string): void {
    const generation = ++this.loadGeneration
    this.clearCurrentModel()

    this.modelGroup.scale.setScalar(1)
    this.applyDefaultModelPosition()
    this.modelGroup.quaternion.identity()
    this.modelGroup.rotation.set(0, 0, 0)

    this.loader.load(
      url,
      (gltf) => {
        if (generation !== this.loadGeneration) {
          disposeObject3D(gltf.scene)
          return
        }

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
        if (generation !== this.loadGeneration) return
        if (event.lengthComputable) {
          this.onLoading?.(
            Math.round((event.loaded / event.total) * 100),
          )
        } else {
          this.onLoading?.(50)
        }
      },
      (error) => {
        if (generation !== this.loadGeneration) return
        console.error('GLB load error:', error)
        this.onError?.('Modell konnte nicht geladen werden.')
      },
    )
  }

  private clearCurrentModel(): void {
    if (!this.currentModel) return
    this.modelGroup.remove(this.currentModel)
    disposeObject3D(this.currentModel)
    this.currentModel = null
  }

  isBackgroundFrozen(): boolean {
    return this.frozen
  }

  private getViewportSize(): { width: number; height: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    }
  }

  private getPreviewPixelSize(): { width: number; height: number } {
    const { width, height } = this.getViewportSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    return {
      width: Math.max(1, Math.round(width * dpr)),
      height: Math.max(1, Math.round(height * dpr)),
    }
  }

  private setFrozenSource(sourceCanvas: HTMLCanvasElement): void {
    const previous = this.frozenBackground?.canvas
    const { width: viewportWidth, height: viewportHeight } = this.getViewportSize()

    this.frozenBackground = {
      canvas: sourceCanvas,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      viewportWidth,
      viewportHeight,
    }

    if (previous && previous !== sourceCanvas) {
      releaseCanvas(previous)
    }

    this.redrawFrozenPreview()
  }

  private redrawFrozenPreview(): void {
    if (!this.frozenBackground) return
    const { width, height } = this.getPreviewPixelSize()
    const { width: vw, height: vh } = this.getViewportSize()
    this.frozenBackground.viewportWidth = vw
    this.frozenBackground.viewportHeight = vh
    drawFrozenPreview(this.frozenBg, this.frozenBackground.canvas, width, height)
  }

  /**
   * Freeze the current live video frame immediately (WYSIWYG).
   * Model stays interactive on top of the photo.
   */
  async takePhoto(): Promise<void> {
    const { width: viewportWidth, height: viewportHeight } = this.getViewportSize()
    if (viewportWidth < 1 || viewportHeight < 1) {
      throw new Error('Viewport nicht bereit')
    }

    const frame = captureVideoFrameSync(this.video, this.maxCaptureEdge)
    this.setFrozenSource(frame)
    this.frozenBg.classList.remove('hidden')
    this.video.classList.add('hidden')
    this.frozen = true
    this.syncMediaState()
  }

  /** @deprecated Use takePhoto — kept for callers that expect sync freeze API. */
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

    const { width, height } = getCaptureOutputSize(
      this.frozenBackground.viewportWidth,
      this.frozenBackground.viewportHeight,
      this.frozenBackground.sourceWidth,
      this.frozenBackground.sourceHeight,
      this.maxCaptureEdge,
    )

    // Pause the live loop so it cannot race a temporary resize of the
    // primary renderer (same WebGL context = correct textures at full res).
    this.stopRenderLoop()
    let foreground: HTMLCanvasElement | null = null
    try {
      foreground = this.renderModelExport(width, height)
      return await compositeHighRes(
        this.frozenBackground,
        foreground,
        this.maxCaptureEdge,
      )
    } finally {
      releaseCanvas(foreground)
      this.ensureRenderLoop()
    }
  }

  /**
   * Render models at export resolution using the primary WebGL context.
   * A second WebGLRenderer cannot reliably reuse textures already uploaded
   * to the live context — that path produced soft / broken model layers
   * while the camera still stayed sharp.
   */
  private renderModelExport(
    outputWidth: number,
    outputHeight: number,
  ): HTMLCanvasElement {
    const cssWidth = this.container.clientWidth
    const cssHeight = this.container.clientHeight
    if (cssWidth < 1 || cssHeight < 1) {
      throw new Error('Viewport nicht bereit')
    }

    const gl = this.renderer.getContext()
    const maxRb =
      typeof gl.getParameter === 'function'
        ? Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || outputWidth
        : outputWidth
    const longest = Math.max(outputWidth, outputHeight)
    const clamp =
      longest > maxRb && longest > 0 ? maxRb / longest : 1
    const width = Math.max(1, Math.round(outputWidth * clamp))
    const height = Math.max(1, Math.round(outputHeight * clamp))

    const prevPixelRatio = this.renderer.getPixelRatio()

    try {
      this.camera.aspect = cssWidth / cssHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(width, height, false)
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear()
      this.renderer.render(this.scene, this.camera)

      const snapshot = document.createElement('canvas')
      snapshot.width = width
      snapshot.height = height
      const ctx = snapshot.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas 2D nicht verfügbar')
      }
      ctx.drawImage(this.renderer.domElement, 0, 0, width, height)
      return snapshot
    } finally {
      this.renderer.setPixelRatio(prevPixelRatio)
      this.renderer.setSize(cssWidth, cssHeight, false)
    }
  }

  unfreeze(): void {
    this.frozenBg.classList.add('hidden')
    if (this.frozenBackground) {
      releaseCanvas(this.frozenBackground.canvas)
      this.frozenBackground = null
    }
    releaseCanvas(this.frozenBg)
    this.video.classList.remove('hidden')
    this.frozen = false
    this.syncMediaState()
  }

  destroy(): void {
    this.loadGeneration += 1
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.unbindEvents()
    this.unfreeze()
    this.stopRenderLoop()
    this.setCameraTracksEnabled(false)
    this.clearCurrentModel()
    const stream = this.video.srcObject
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    this.video.srcObject = null
    this.renderer.dispose()
    this.video.remove()
    this.frozenBg.remove()
    this.canvas.remove()
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.pointers.clear()
    this.gesture = 'none'
  }

  private applyDefaultModelPosition(): void {
    this.modelGroup.position.set(0, 0, 0)
  }

  /**
   * Keep the MediaStream (and its negotiated resolution) alive, but disable
   * capture when the photo is frozen or the tab is backgrounded.
   */
  private syncMediaState(): void {
    const shouldCapture = !this.frozen && !document.hidden
    this.setCameraTracksEnabled(shouldCapture)

    if (document.hidden) {
      this.stopRenderLoop()
    } else {
      this.ensureRenderLoop()
    }
  }

  private setCameraTracksEnabled(enabled: boolean): void {
    if (this.cameraTracksEnabled === enabled) return
    this.cameraTracksEnabled = enabled

    const stream = this.video.srcObject
    if (stream instanceof MediaStream) {
      for (const track of stream.getVideoTracks()) {
        track.enabled = enabled
      }
    }

    if (enabled) {
      void this.video.play().catch(() => {})
    } else {
      this.video.pause()
    }
  }

  private onVisibilityChange = (): void => {
    this.syncMediaState()
  }

  private ensureRenderLoop(): void {
    if (this.renderRunning || document.hidden) return
    this.renderRunning = true
    this.renderLoop()
  }

  private stopRenderLoop(): void {
    this.renderRunning = false
    cancelAnimationFrame(this.animationId)
    this.animationId = 0
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
    if (!this.renderRunning || document.hidden) {
      this.renderRunning = false
      this.animationId = 0
      return
    }

    this.animationId = requestAnimationFrame(this.renderLoop)
    this.renderer.render(this.scene, this.camera)
  }

  private onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    this.canvas.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 1) {
      // Secondary / middle button: pan with one pointer (desktop).
      if (event.button === 1 || event.button === 2 || event.shiftKey) {
        this.beginPinchGesture()
        this.pinchStart.midX = event.clientX
        this.pinchStart.midY = event.clientY
        this.pinchStart.distance = 0
      } else {
        this.gesture = 'rotate'
        this.lastPointer = { x: event.clientX, y: event.clientY }
      }
      return
    }

    if (this.pointers.size === 2) {
      this.beginPinchGesture()
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.gesture === 'rotate' && this.pointers.size === 1) {
      const width = Math.max(1, this.container.clientWidth)
      const height = Math.max(1, this.container.clientHeight)
      const dx = event.clientX - this.lastPointer.x
      const dy = event.clientY - this.lastPointer.y
      this.lastPointer = { x: event.clientX, y: event.clientY }
      this.tumbleModel(
        (dx / width) * CameraARViewer.ROTATE_SPEED,
        (dy / height) * CameraARViewer.ROTATE_SPEED,
      )
      return
    }

    if (this.gesture === 'pinch' && this.pointers.size >= 1) {
      this.updatePinchGesture()
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return
    this.pointers.delete(event.pointerId)

    if (this.pointers.size === 0) {
      this.gesture = 'none'
      return
    }

    if (this.pointers.size === 1) {
      // After lifting one finger of a pinch, continue as rotate.
      const remaining = [...this.pointers.values()][0]!
      this.gesture = 'rotate'
      this.lastPointer = { x: remaining.x, y: remaining.y }
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.92 : 1.08
    const next = this.modelGroup.scale.x * factor
    this.modelGroup.scale.setScalar(THREE.MathUtils.clamp(next, 0.2, 4))
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  /**
   * Screen-space tumble: horizontal drag spins around world up,
   * vertical drag around camera right — free rotation without gimbal lock.
   */
  private tumbleModel(yaw: number, pitch: number): void {
    this._qYaw.setFromAxisAngle(this._axisY, yaw)
    this._qPitch.setFromAxisAngle(this._axisX, pitch)
    this.modelGroup.quaternion.premultiply(this._qYaw).premultiply(this._qPitch)
  }

  private beginPinchGesture(): void {
    this.gesture = 'pinch'
    const mid = this.getPointerMidpoint()
    this.pinchStart = {
      distance: this.getPinchDistance(),
      scale: this.modelGroup.scale.x,
      midX: mid.x,
      midY: mid.y,
      modelX: this.modelGroup.position.x,
      modelY: this.modelGroup.position.y,
    }
  }

  private updatePinchGesture(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const mid = this.getPointerMidpoint()

    this.modelGroup.position.x =
      this.pinchStart.modelX +
      ((mid.x - this.pinchStart.midX) / width) * CameraARViewer.PAN_SPEED
    this.modelGroup.position.y =
      this.pinchStart.modelY -
      ((mid.y - this.pinchStart.midY) / height) * CameraARViewer.PAN_SPEED

    const distance = this.getPinchDistance()
    if (this.pinchStart.distance > 0 && distance > 0) {
      const scale =
        this.pinchStart.scale * (distance / this.pinchStart.distance)
      this.modelGroup.scale.setScalar(THREE.MathUtils.clamp(scale, 0.2, 4))
    }
  }

  private getPinchDistance(): number {
    const points = [...this.pointers.values()]
    if (points.length < 2) return 0
    const dx = points[1]!.x - points[0]!.x
    const dy = points[1]!.y - points[0]!.y
    return Math.hypot(dx, dy)
  }

  private getPointerMidpoint(): { x: number; y: number } {
    const points = [...this.pointers.values()]
    if (points.length === 0) return { x: 0, y: 0 }
    if (points.length === 1) {
      return { x: points[0]!.x, y: points[0]!.y }
    }
    return {
      x: (points[0]!.x + points[1]!.x) / 2,
      y: (points[0]!.y + points[1]!.y) / 2,
    }
  }
}
