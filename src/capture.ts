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
): { width: number; height: number; scale: number } {
  const crop = getVideoCoverCrop(
    viewportWidth,
    viewportHeight,
    sourceWidth,
    sourceHeight,
  )
  const scale = crop.sw / viewportWidth

  return {
    width: Math.round(crop.sw),
    height: Math.round(crop.sh),
    scale,
  }
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

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas 2D nicht verfügbar')
  }
  applySmoothing(ctx)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

export function captureVideoFrameSync(
  video: HTMLVideoElement,
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
  return canvas
}

export async function captureHiResPhoto(
  track: MediaStreamTrack,
): Promise<HTMLCanvasElement | null> {
  if (typeof ImageCapture === 'undefined') return null

  try {
    const capture = new ImageCapture(track)
    const blob = await capture.takePhoto()
    return blobToCanvas(blob)
  } catch {
    return null
  }
}

export async function captureCameraPhoto(
  track: MediaStreamTrack,
  video: HTMLVideoElement,
): Promise<HTMLCanvasElement> {
  const hiRes = await captureHiResPhoto(track)
  if (hiRes) return hiRes
  return captureVideoFrameSync(video)
}

export function compositeHighRes(
  background: FrozenBackground,
  foreground: CanvasImageSource,
): Promise<Blob> {
  const { width, height } = getCaptureOutputSize(
    background.viewportWidth,
    background.viewportHeight,
    background.sourceWidth,
    background.sourceHeight,
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
  ctx.drawImage(foreground, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Export fehlgeschlagen'))
      },
      'image/jpeg',
      0.98,
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
