export type ARMode = 'webxr' | 'quick-look' | 'portal'

export function isIOSDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export async function detectARMode(hasUsdz: boolean): Promise<ARMode> {
  const isIOS = isIOSDevice()

  if (!isIOS && navigator.xr) {
    try {
      const supported = await withTimeout(
        navigator.xr.isSessionSupported('immersive-ar'),
        800,
        false,
      )
      if (supported) return 'webxr'
    } catch {
      /* fallback below */
    }
  }

  if (isIOS && hasUsdz) return 'quick-look'
  return 'portal'
}

export type CapturePhase = 'live' | 'photo'

export function hintForMode(
  _activeView: 'portal' | 'webxr',
  roomCapability: ARMode,
  placed = false,
  capturePhase: CapturePhase = 'live',
): string {
  if (capturePhase === 'photo') {
    return 'Drehen · Zwei Finger: verschieben/skalieren · Speichern'
  }

  if (_activeView === 'webxr') {
    const base = placed
      ? 'Gehe herum · Objekt steht im Raum'
      : 'Bewege das Gerät · Tippe zum Platzieren'
    return `${base} · Shutter: Foto`
  }

  if (roomCapability === 'quick-look') {
    return 'Modell wählen · dann „In den Raum platzieren“ (Safari)'
  }

  if (roomCapability === 'webxr') {
    return 'Raum-AR verfügbar · Button oben oder neu starten · Shutter: Foto'
  }

  return 'Drehen · Zwei Finger: verschieben/skalieren · Shutter: Foto'
}
