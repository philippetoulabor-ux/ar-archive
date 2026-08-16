import './style.css'
import { asset } from './assets.ts'
import {
  detectARMode,
  hintForMode,
  isRestrictedInAppBrowser,
  type ARMode,
  type CapturePhase,
} from './ar-capabilities.ts'
import { CameraARViewer } from './camera-ar.ts'
import { saveImageBlob } from './capture.ts'
import { models, type ModelAsset } from './models.ts'
import {
  supportsQuickLookLink,
  updateQuickLookAnchor,
} from './quick-look.ts'
import { RoomARViewer } from './room-ar-viewer.ts'

const app = document.querySelector<HTMLDivElement>('#app')!
let activeModel: ModelAsset = models[0]!
let roomCapability: ARMode = 'portal'
let activeView: 'portal' | 'webxr' = 'portal'
let portalViewer: CameraARViewer | null = null
let roomViewer: RoomARViewer | null = null
let started = false
let capturePhase: CapturePhase = 'live'
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
      <p class="start-text">Touch the screen</p>
      <p class="start-sub" id="start-sub">Start camera & AR</p>
    </div>

    <div class="hud">
      <div class="hud-top">
        <p class="hud-label">Modell</p>
        <h1 class="hud-title" id="model-title">${models[0]!.name}</h1>
        <a
          rel="ar"
          href="#"
          class="hud-mode hud-quick-look hidden"
          id="hud-quick-look"
        >
          <img src="${asset('ar-poster.png')}" alt="In AR ansehen" width="48" height="48" />
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
                <img
                  class="model-chip-preview"
                  src="${model.thumb}"
                  alt=""
                  width="128"
                  height="128"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            `,
          )
          .join('')}
      </div>

      <button type="button" class="shutter-btn hidden" id="shutter-btn" aria-label="Aufnahme"></button>
      <div class="compose-actions hidden" id="compose-actions">
        <button type="button" class="compose-save-btn" id="compose-save-btn">SAVE</button>
        <button type="button" class="compose-close-btn" id="compose-close-btn" aria-label="Zurück">
          <svg class="compose-close-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4.5 12a7.5 7.5 0 1 0 2.1-5.2M4.5 4.5v4.2h4.2"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="shutter-flash" id="shutter-flash" aria-hidden="true"></div>

    <div class="save-fallback hidden" id="save-fallback" role="dialog" aria-modal="true" aria-labelledby="save-fallback-hint">
      <img class="save-fallback-img" id="save-fallback-img" alt="Aufnahme" />
      <p class="save-fallback-hint" id="save-fallback-hint">Lange drücken → Bild sichern</p>
      <button type="button" class="save-fallback-close" id="save-fallback-close">Schließen</button>
    </div>

    <p class="gesture-hint hidden" id="gesture-hint">Drehen · Zwei Finger verschieben</p>
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
const composeActions = document.querySelector('#compose-actions') as HTMLElement
const composeSaveBtn = document.querySelector('#compose-save-btn') as HTMLButtonElement
const composeCloseBtn = document.querySelector('#compose-close-btn') as HTMLButtonElement
const shutterFlash = document.querySelector('#shutter-flash') as HTMLElement
const saveFallback = document.querySelector('#save-fallback') as HTMLElement
const saveFallbackImg = document.querySelector('#save-fallback-img') as HTMLImageElement
const saveFallbackClose = document.querySelector('#save-fallback-close') as HTMLButtonElement

let saveFallbackObjectUrl: string | null = null

function triggerShutterFlash(): void {
  shutterFlash.classList.remove('active')
  void shutterFlash.offsetWidth
  shutterFlash.classList.add('active')
}

function closeSaveFallback(): void {
  saveFallback.classList.add('hidden')
  saveFallbackImg.removeAttribute('src')
  if (saveFallbackObjectUrl) {
    URL.revokeObjectURL(saveFallbackObjectUrl)
    saveFallbackObjectUrl = null
  }
}

function showSaveFallback(blob: Blob): void {
  closeSaveFallback()
  saveFallbackObjectUrl = URL.createObjectURL(blob)
  saveFallbackImg.src = saveFallbackObjectUrl
  saveFallback.classList.remove('hidden')
}

function getActiveViewer(): CameraARViewer | RoomARViewer | null {
  return activeView === 'webxr' ? roomViewer : portalViewer
}

function resetCaptureState(): void {
  closeSaveFallback()
  getActiveViewer()?.unfreeze()
  capturePhase = 'live'
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
    startSub.textContent = 'Start room AR · place model on floor'
  } else if (roomCapability === 'quick-look' && activeModel.usdz) {
    startSub.textContent = 'Start camera · then “Place in room”'
  } else {
    startSub.textContent = 'Start camera'
  }
}

function updateGestureHint(hint: string, force = false): void {
  if (!started || (gestureHintDismissed && !force)) {
    gestureHint.classList.add('hidden')
    return
  }

  gestureHint.textContent = hint
  gestureHint.classList.remove('hidden')

  if (!force && !gestureHintTimer) {
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

  if (
    capturePhase !== 'photo' &&
    isRestrictedInAppBrowser() &&
    !gestureHintDismissed
  ) {
    hint += ' · Speichern: Share oder lange drücken'
  }

  updateGestureHint(hint, capturePhase === 'photo')

  const viewerActive = Boolean(portalViewer || roomViewer)
  const showShutter = viewerActive && started && capturePhase === 'live'
  const showCompose = viewerActive && started && capturePhase === 'photo'
  shutterBtn.classList.toggle('hidden', !showShutter)
  composeActions.classList.toggle('hidden', !showCompose)

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
    updateUI()
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

composeSaveBtn.addEventListener('click', () => {
  void onComposeSave()
})

composeCloseBtn.addEventListener('click', () => {
  resetCaptureState()
  updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
})

saveFallbackClose.addEventListener('click', () => {
  closeSaveFallback()
})

async function onShutterClick(): Promise<void> {
  const viewer = getActiveViewer()
  if (!viewer || capturePhase !== 'live') return

  shutterBtn.disabled = true
  triggerShutterFlash()

  try {
    await viewer.takePhoto()
    capturePhase = 'photo'
    updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
  } catch (error) {
    console.error('Photo failed:', error)
    viewer.unfreeze()
    capturePhase = 'live'
    updateUI(activeView === 'webxr' && (roomViewer?.isPlaced() ?? false))
  } finally {
    shutterBtn.disabled = false
  }
}

async function onComposeSave(): Promise<void> {
  const viewer = getActiveViewer()
  if (!viewer || capturePhase !== 'photo') return

  composeSaveBtn.disabled = true
  triggerShutterFlash()

  try {
    const blob = await viewer.captureComposite()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `ar-aufnahme-${timestamp}.jpg`
    const restricted = isRestrictedInAppBrowser()
    const result = await saveImageBlob(blob, filename, {
      allowDownload: !restricted,
    })

    if (result === 'unavailable' && restricted) {
      showSaveFallback(blob)
    }
  } catch (error) {
    console.error('Compose failed:', error)
  } finally {
    composeSaveBtn.disabled = false
  }
}

void refreshCapability()
