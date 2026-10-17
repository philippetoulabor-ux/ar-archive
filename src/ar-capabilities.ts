export type ARMode = 'webxr' | 'quick-look' | 'portal'

export function isIOSDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Instagram / Facebook / similar WebViews where <a download> often just opens the blob. */
export function isRestrictedInAppBrowser(): boolean {
  const ua = navigator.userAgent
  return (
    /Instagram/i.test(ua) ||
    /FBAN|FBAV|FB_IAB|FB4A|FBAN\//i.test(ua) ||
    /Line\//i.test(ua) ||
    /Twitter|X\/|LinkedInApp|Snapchat|TikTok|BytedanceWebview|Musical_ly/i.test(ua)
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
