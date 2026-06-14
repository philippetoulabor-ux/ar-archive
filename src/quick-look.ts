import { asset } from './assets.ts'

const POSTER = asset('ar-poster.png')

export function toAbsoluteUrl(path: string): string {
  return new URL(path, window.location.href).href
}

export function supportsQuickLookLink(): boolean {
  const probe = document.createElement('a')
  return probe.relList?.supports?.('ar') ?? false
}

/** Safari braucht ein echtes <a rel="ar"> mit genau einem <img>-Kind — kein programmatischer Klick. */
export function updateQuickLookAnchor(
  anchor: HTMLAnchorElement,
  usdzPath: string,
): void {
  const url = toAbsoluteUrl(usdzPath)
  anchor.href = url
  anchor.rel = 'ar'

  let img = anchor.querySelector('img')
  if (!img) {
    img = document.createElement('img')
    img.src = toAbsoluteUrl(POSTER)
    img.alt = 'In AR ansehen'
    img.width = 48
    img.height = 48
    anchor.replaceChildren(img)
  }
}
