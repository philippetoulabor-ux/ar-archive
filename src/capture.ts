export interface VideoContainRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FrozenBackground {
  canvas: HTMLCanvasElement
  sourceWidth: number
  sourceHeight: number
  viewportWidth: number
  viewportHeight: number
}

export interface VideoCoverCrop {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Hard cap for composite export / still storage (longest edge). */
export const MAX_CAPTURE_EDGE = 4096

/** Softer cap for low-memory devices / OOM fallback. */
export const SOFT_CAPTURE_EDGE = 2560

/** JPEG quality for final export (1 = highest within JPEG). */
export const EXPORT_JPEG_QUALITY = 1

/**
 * Highest safe longest-edge for this device (frozen still + composite export).
 * Live preview requests up to 4K when the camera allows it.
 */
export function getRecommendedCaptureEdge(): number {
  const mem = navigator.deviceMemory
  if (typeof mem === 'number') {
    if (mem <= 2) return SOFT_CAPTURE_EDGE
    if (mem <= 4) return 3072
    return MAX_CAPTURE_EDGE
  }
  // iOS Safari rarely exposes deviceMemory; modern phones handle 4096.
  return MAX_CAPTURE_EDGE
}

export function getVideoCoverCrop(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): VideoCoverCrop {
  const sourceAspect = sourceWidth / sourceHeight
  const containerAspect = containerWidth / containerHeight

  if (sourceAspect > containerAspect) {
    const sh = sourceHeight
    const sw = sourceHeight * containerAspect
    return {
      sx: (sourceWidth - sw) / 2,
      sy: 0,
      sw,
      sh,
    }
  }

  const sw = sourceWidth
  const sh = sourceWidth / containerAspect
  return {
    sx: 0,
    sy: (sourceHeight - sh) / 2,
    sw,
    sh,
  }
}

export function getVideoContainRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): VideoContainRect {
  const sourceAspect = sourceWidth / sourceHeight
  const containerAspect = containerWidth / containerHeight

  if (sourceAspect > containerAspect) {
    const width = containerWidth
    const height = containerWidth / sourceAspect
    return { x: 0, y: (containerHeight - height) / 2, width, height }
  }

  const height = containerHeight
  const width = containerHeight * sourceAspect
  return { x: (containerWidth - width) / 2, y: 0, width, height }
}

export function getCaptureOutputSize(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = MAX_CAPTURE_EDGE,
): { width: number; height: number; scale: number } {
  const crop = getVideoCoverCrop(
    viewportWidth,
    viewportHeight,
    sourceWidth,
    sourceHeight,
  )

  let width = Math.round(crop.sw)
  let height = Math.round(crop.sh)
  const longest = Math.max(width, height)

  if (longest > maxEdge && longest > 0) {
    const factor = maxEdge / longest
    width = Math.max(1, Math.round(width * factor))
    height = Math.max(1, Math.round(height * factor))
  }

  const scale = width / viewportWidth

  return { width, height, scale }
}

export function getCanvasSourceSize(source: CanvasImageSource): {
  width: number
  height: number
} {
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height }
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  if (source instanceof ImageBitmap) {
    return { width: source.width, height: source.height }
  }
  if (source instanceof OffscreenCanvas) {
    return { width: source.width, height: source.height }
  }
  throw new Error('Unbekannte Bildquelle')
}

function applySmoothing(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
}

/** Release backing store so GC can reclaim large canvases. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

export function scaleCanvasToMaxEdge(
  source: HTMLCanvasElement,
  maxEdge: number,
): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height)
  if (longest <= maxEdge || longest < 1) return source

  const factor = maxEdge / longest
  const width = Math.max(1, Math.round(source.width * factor))
  const height = Math.max(1, Math.round(source.height * factor))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source
  applySmoothing(ctx)
  ctx.drawImage(source, 0, 0, width, height)
  if (canvas !== source) releaseCanvas(source)
  return canvas
}

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  const { width: sourceWidth, height: sourceHeight } = getCanvasSourceSize(source)
  if (sourceWidth < 1 || sourceHeight < 1) return

  const { sx, sy, sw, sh } = getVideoCoverCrop(
    width,
    height,
    sourceWidth,
    sourceHeight,
  )
  applySmoothing(ctx)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height)
}

export function drawImageContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const { width: sourceWidth, height: sourceHeight } = getCanvasSourceSize(source)
  if (sourceWidth < 1 || sourceHeight < 1) return

  const rect = getVideoContainRect(width, height, sourceWidth, sourceHeight)
  applySmoothing(ctx)
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height)
}

export function drawVideoContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  drawImageContain(ctx, video, width, height)
}

export function captureVideoFrameSync(
  video: HTMLVideoElement,
  maxEdge = MAX_CAPTURE_EDGE,
): HTMLCanvasElement {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width < 1 || height < 1) {
    throw new Error('Kamera-Frame nicht verfügbar')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D nicht verfügbar')
  }
  ctx.drawImage(video, 0, 0, width, height)
  return scaleCanvasToMaxEdge(canvas, maxEdge)
}

export function compositeHighRes(
  background: FrozenBackground,
  foreground: CanvasImageSource,
  maxEdge = MAX_CAPTURE_EDGE,
): Promise<Blob> {
  const { width, height } = getCaptureOutputSize(
    background.viewportWidth,
    background.viewportHeight,
    background.sourceWidth,
    background.sourceHeight,
    maxEdge,
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return Promise.reject(new Error('Canvas 2D nicht verfügbar'))
  }

  applySmoothing(ctx)
  drawImageCover(ctx, background.canvas, width, height)
  // Models are rendered at export resolution — avoid smoothing that softens edges
  // when the GPU drawing buffer is 1:1 with the output (or nearly so).
  const fg = getCanvasSourceSize(foreground)
  if (fg.width === width && fg.height === height) {
    ctx.imageSmoothingEnabled = false
  }
  ctx.drawImage(foreground, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        releaseCanvas(canvas)
        if (blob) resolve(blob)
        else reject(new Error('Export fehlgeschlagen'))
      },
      'image/jpeg',
      EXPORT_JPEG_QUALITY,
    )
  })
}

export function drawFrozenPreview(
  target: HTMLCanvasElement,
  source: CanvasImageSource,
  viewportWidth: number,
  viewportHeight: number,
): void {
  target.width = viewportWidth
  target.height = viewportHeight
  const ctx = target.getContext('2d')
  if (!ctx) return
  drawImageCover(ctx, source, viewportWidth, viewportHeight)
}

export function createViewportPreview(
  source: CanvasImageSource,
  viewportWidth: number,
  viewportHeight: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = viewportWidth
  canvas.height = viewportHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  drawImageCover(ctx, source, viewportWidth, viewportHeight)
  return canvas.toDataURL('image/jpeg', 0.92)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export type SaveImageResult = 'shared' | 'downloaded' | 'cancelled' | 'unavailable'

function toImageFile(blob: Blob, filename: string): File {
  return new File([blob], filename, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  })
}

export function canShareImageFile(file: File): boolean {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }))
  } catch {
    return false
  }
}

export async function shareImageBlob(
  blob: Blob,
  filename: string,
): Promise<'shared' | 'cancelled'> {
  const file = toImageFile(blob, filename)
  if (!canShareImageFile(file)) {
    throw new Error('Share not available')
  }

  try {
    await navigator.share({ files: [file], title: filename })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled'
    }
    throw error
  }
}

/** Share-first when possible; otherwise download (unless allowDownload is false). AbortError → cancelled. */
export async function saveImageBlob(
  blob: Blob,
  filename: string,
  options: { allowDownload?: boolean } = {},
): Promise<SaveImageResult> {
  const allowDownload = options.allowDownload !== false
  const file = toImageFile(blob, filename)

  if (canShareImageFile(file)) {
    try {
      return await shareImageBlob(blob, filename)
    } catch {
      /* fall through */
    }
  }

  if (!allowDownload) return 'unavailable'

  downloadBlob(blob, filename)
  return 'downloaded'
}
