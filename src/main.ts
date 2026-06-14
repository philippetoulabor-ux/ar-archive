import './style.css'
import { detectARMode, hintForMode, type ARMode, type CapturePhase } from './ar-capabilities.ts'
import { CameraARViewer } from './camera-ar.ts'
import { downloadBlob } from './capture.ts'
import { models, type ModelAsset } from './models.ts'
import {
  supportsQuickLookLink,
  updateQuickLookAnchor,
} from './quick-look.ts'
import { RoomARViewer } from './room-ar-viewer.ts'
import { renderModelPreview } from './model-preview.ts'

const app = document.querySelector<HTMLDivElement>('#app')!
let activeModel: ModelAsset = models[0]!
let roomCapability: ARMode = 'portal'
let activeView: 'portal' | 'webxr' = 'portal'
let portalViewer: CameraARViewer | null = null
let roomViewer: RoomARViewer | null = null
let started = false
let capturePhase: CapturePhase = 'live'
let lastCaptureBlob: Blob | null = null
let previewObjectUrl: string | null = null
let gestureHintDismissed = false
let gestureHintTimer: ReturnType<typeof setTimeout> | null = null

const GESTURE_HINT_DURATION_MS = 4000

app.innerHTML = `
  <div class="ar-app" id="ar-app">
    <div class="ar-stage" id="ar-stage">
      <div class="loading-overlay hidden" id="loading">
        <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill"></div></div>
        <span id="loading-text">Modell wird geladen…</span>
      </div>
    </div>

    <div class="start-overlay" id="start-overlay">
      <p class="start-text">Berühre den Bildschirm</p>
      <p class="start-sub" id="start-sub">Kamera & AR starten</p>
    </div>

    <div class="hud">
      <div class="hud-top">
        <p class="hud-label">Modell</p>
        <h1 class="hud-title" id="model-title">${models[0]!.name}</h1>
        <a
          rel="ar"
          href="/models/astronaut.usdz"
          class="hud-mode hud-quick-look hidden"
          id="hud-quick-look"
        >
          <img src="/ar-poster.png" alt="In AR ansehen" width="48" height="48" />
        </a>
        <button type="button" class="hud-mode hidden" id="hud-webxr">
          ↗ Raum-AR starten
        </button>
      </div>

      <div class="model-bar" id="model-bar">
        ${models
          .map(
            (model) => `
              <button
                type="button"
                class="model-chip ${model.id === activeModel.id ? 'active' : ''}"
                data-model-id="${model.id}"
                aria-label="${model.name}"
              >
                <canvas class="model-chip-preview" width="128" height="128"></canvas>
              </button>
            `,
          )
          .join('')}
      </div>

      <button type="button" class="shutter-btn hidden" id="shutter-btn" aria-label="Aufnahme"></button>
    </div>

    <div class="capture-preview hidden" id="capture-preview">
      <img id="capture-preview-img" alt="Aufnahme" />
      <div class="capture-preview-actions">
        <button type="button" class="capture-action-btn" id="capture-download">Speichern</button>
        <button type="button" class="capture-action-btn" id="capture-close">Schliessen</button>
      </div>
    </div>

    <div class="shutter-flash" id="shutter-flash" aria-hidden="true"></div>

    <p class="gesture-hint hidden" id="gesture-hint">Ziehen · Pinch · Drehen</p>
  </div>
`

const arApp = document.querySelector('#ar-app') as HTMLElement
const stage = document.querySelector('#ar-stage') as HTMLElement
const startOverlay = document.querySelector('#start-overlay') as HTMLElement
const startSub = document.querySelector('#start-sub')!
const loadingEl = document.querySelector('#loading')!
const progressFill = document.querySelector('#progress-fill') as HTMLDivElement
const loadingText = document.querySelector('#loading-text')!
const modelTitle = document.querySelector('#model-title')!
const hudQuickLook = document.querySelector('#hud-quick-look') as HTMLAnchorElement
const hudWebXR = document.querySelector('#hud-webxr') as HTMLButtonElement
const modelBar = document.querySelector('#model-bar')!
const gestureHint = document.querySelector('#gesture-hint')!
const shutterBtn = document.querySelector('#shutter-btn') as HTMLButtonElement
const capturePreview = document.querySelector('#capture-preview') as HTMLElement
const capturePreviewImg = document.querySelector('#capture-preview-img') as HTMLImageElement
const captureDownload = document.querySelector('#capture-download') as HTMLButtonElement
const captureClose = document.querySelector('#capture-close') as HTMLButtonElement
const shutterFlash = document.querySelector('#shutter-flash') as HTMLElement

function triggerShutterFlash(): void {
  shutterFlash.classList.remove('active')
  void shutterFlash.offsetWidth
  shutterFlash.classList.add('active')
}

function getActiveViewer(): CameraARViewer | RoomARViewer | null {
  return activeView === 'webxr' ? roomViewer : portalViewer
}

function hidePreviewOnly(): void {
  capturePreview.classList.add('hidden')
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = null
  }
  capturePreviewImg.removeAttribute('src')
}

function resetCaptureState(): void {
  getActiveViewer()?.unfreeze()
  capturePhase = 'live'
  lastCaptureBlob = null
}

function hidePreview(): void {
  hidePreviewOnly()
  resetCaptureState()
}

function showPreview(blob: Blob): void {
  hidePreviewOnly()
  lastCaptureBlob = blob
  previewObjectUrl = URL.createObjectURL(blob)
  capturePreviewImg.src = previewObjectUrl
  capturePreview.classList.remove('hidden')
}

function isLikelyDevHost(): boolean {
  const host = location.hostname
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  )
}

function setLoading(visible: boolean, text?: string, percent?: number): void {
  loadingEl.classList.toggle('hidden', !visible)
  if (text) loadingText.textContent = text
  if (percent !== undefined) progressFill.style.width = `${percent}%`
}

function updateStartSub(): void {
  if (roomCapability === 'webxr') {
    startSub.textContent = 'Raum-AR starten · Modell auf Boden platzieren'
  } else if (roomCapability === 'quick-look' && activeModel.usdz) {
    startSub.textContent = 'Kamera starten · danach „In den Raum platzieren“'
  } else {
    startSub.textContent = 'Kamera starten'
  }
}

function updateGestureHint(hint: string): void {
  if (!started || gestureHintDismissed) {
    gestureHint.classList.add('hidden')
    return
  }

  gestureHint.textContent = hint
  gestureHint.classList.remove('hidden')

  if (!gestureHintTimer) {
    gestureHintTimer = setTimeout(() => {
      gestureHintDismissed = true
      gestureHint.classList.add('hidden')
      gestureHintTimer = null
    }, GESTURE_HINT_DURATION_MS)
  }
}

function updateUI(placed = false): void {
  let hint = hintForMode(activeView, roomCapability, placed, capturePhase)

  if (
    roomCapability === 'quick-look' &&
    activeView === 'portal' &&
    isLikelyDevHost()
  ) {
    hint +=
      ' · Quick Look braucht vertrauenswürdiges HTTPS (nicht Dev-Zertifikat)'
  }

  if (roomCapability === 'quick-look' && !supportsQuickLookLink()) {
    hint = 'Quick Look nur in Safari (nicht In-App-Browser)'
  }

  updateGestureHint(hint)

  const viewerActive = Boolean(portalViewer || roomViewer)
  shutterBtn.classList.toggle('hidden', !viewerActive || !started)

  hudQuickLook.classList.add('hidden')
  hudWebXR.classList.add('hidden')

  if (activeView === 'webxr') return

  if (roomCapability === 'quick-look' && activeModel.usdz) {
    updateQuickLookAnchor(hudQuickLook, activeModel.usdz)
    hudQuickLook.classList.remove('hidden')
  } else if (roomCapability === 'webxr') {
    hudWebXR.classList.remove('hidden')
  }
}

async function refreshCapability(): Promise<void> {
  roomCapability = await detectARMode(Boolean(activeModel.usdz))
  updateStartSub()
  updateUI()
}

async function startPortal(): Promise<void> {
  resetCaptureState()
  hidePreview()
  portalViewer?.destroy()
  portalViewer = new CameraARViewer({
    container: stage,
    onLoading: (p) => setLoading(true, `Modell wird geladen… ${p}%`, p),
    onModelLoaded: () => setLoading(false),
    onError: (msg) => {
      setLoading(true, msg)
      loadingEl.classList.remove('hidden')
    },
  })

  await portalViewer.start()
  activeView = 'portal'
  updateUI()
  setLoading(true, 'Modell wird geladen…', 0)
  portalViewer.loadModel(activeModel.glb)
}

async function startWebXR(): Promise<void> {
  resetCaptureState()
  hidePreview()
  portalViewer?.destroy()
  portalViewer = null

  roomViewer = new RoomARViewer({
    stage,
    domOverlayRoot: arApp,
    onLoading: (p) => setLoading(true, `Modell wird geladen… ${p}%`, p),
    onModelLoaded: () => setLoading(false),
    onPlaced: () => updateUI(true),
    onError: (msg) => setLoading(true, msg),
    onSessionEnded: async () => {
      roomViewer = null
      activeView = 'portal'
      try {
        await startPortal()
      } catch {
        started = false
        startOverlay.classList.remove('hidden')
      }
    },
  })

  await roomViewer.start()
  activeView = 'webxr'
  setLoading(true, 'Modell wird geladen…', 0)
  roomViewer.loadModel(activeModel.glb)
  updateUI()
}

async function beginExperience(): Promise<void> {
  if (started) return
  started = true
  startOverlay.classList.add('hidden')

  await refreshCapability()

  try {
    if (roomCapability === 'webxr') {
      await startWebXR()
    } else {
      await startPortal()
    }
  } catch {
    if (roomCapability === 'webxr') {
      try {
        await startPortal()
        return
      } catch {
        /* fall through */
      }
    }

    portalViewer?.destroy()
    portalViewer = null
    roomViewer?.destroy()
    roomViewer = null
    started = false
    startOverlay.classList.remove('hidden')
  }
}

async function switchModel(model: ModelAsset): Promise<void> {
  resetCaptureState()
  hidePreview()
  activeModel = model
  modelTitle.textContent = model.name

  modelBar.querySelectorAll('.model-chip').forEach((chip) => {
    chip.classList.toggle(
      'active',
      (chip as HTMLElement).dataset.modelId === model.id,
    )
  })

  await refreshCapability()

  if (roomViewer) {
    setLoading(true, 'Modell wird geladen…', 0)
    roomViewer.loadModel(model.glb)
    updateUI(false)
    return
  }

  if (portalViewer) {
    setLoading(true, 'Modell wird geladen…', 0)
    portalViewer.loadModel(model.glb)
  }
}

startOverlay.addEventListener('click', () => {
  void beginExperience()
})

hudWebXR.addEventListener('click', () => {
  void startWebXR().catch(async () => {
    setLoading(true, 'WebXR fehlgeschlagen')
    if (!portalViewer) {
      try {
        await startPortal()
      } catch {
        started = false
        startOverlay.classList.remove('hidden')
      }
    }
  })
})

modelBar.addEventListener('click', (event) => {
  const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-model-id]',
  )
  if (!chip) return

  const model = models.find((item) => item.id === chip.dataset.modelId)
  if (model && model.id !== activeModel.id) {
    void switchModel(model)
  }
})

shutterBtn.addEventListener('click', () => {
  void onShutterClick()
})

captureDownload.addEventListener('click', () => {
  if (!lastCaptureBlob) return
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  downloadBlob(lastCaptureBlob, `ar-aufnahme-${timestamp}.jpg`)
})

captureClose.addEventListener('click', () => {
  hidePreview()
  updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
})

async function onShutterClick(): Promise<void> {
  const viewer = getActiveViewer()
  if (!viewer) return

  triggerShutterFlash()

  if (capturePhase === 'live') {
    viewer.freezeBackground()
    capturePhase = 'frozen'
    updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
    return
  }

  shutterBtn.disabled = true

  try {
    const blob = await viewer.captureComposite()
    showPreview(blob)
    updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
  } catch (error) {
    console.error('Capture failed:', error)
  } finally {
    shutterBtn.disabled = false
  }
}

void refreshCapability()

function initModelPreviews(): void {
  modelBar.querySelectorAll<HTMLButtonElement>('.model-chip').forEach((chip) => {
    const model = models.find((item) => item.id === chip.dataset.modelId)
    const canvas = chip.querySelector<HTMLCanvasElement>('.model-chip-preview')
    if (!model || !canvas) return
    void renderModelPreview(canvas, model.glb)
  })
}

initModelPreviews()
