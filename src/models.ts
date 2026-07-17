import { asset } from './assets.ts'

export interface ModelAsset {
  id: string
  name: string
  description: string
  glb: string
  /** Static chip preview (baked via `npm run bake-thumbs`). */
  thumb: string
  usdz?: string
  poster?: string
}

function modelAsset(
  id: string,
  name: string,
  description: string,
  extras: Partial<Pick<ModelAsset, 'usdz' | 'poster'>> = {},
): ModelAsset {
  return {
    id,
    name,
    description,
    glb: asset(`models/${id}.glb`),
    thumb: asset(`models/thumbs/${id}.webp`),
    ...extras,
  }
}

export const models: ModelAsset[] = [
  modelAsset('middleman', 'Middleman', 'Regalfigur aus dem Wohnzimmer.'),
  modelAsset('ls-candle', 'Lucky Star Kerze', 'Leuchtende Kerze aus dem Regal.'),
  modelAsset('alien-chair', 'Alien Chair', 'Stuhl mit Alien-Design.'),
  modelAsset(
    'x-bock-couch',
    'X-Bock Couch',
    'Modulare Sitzmöbel-Konstruktion.',
  ),
  modelAsset('weblampe', 'Weblampe', 'Gewebte Lichtskulptur.'),
  modelAsset(
    'speaker-module',
    'Speaker Module',
    'Lautsprecher-Modul aus dem Soundsystem.',
  ),
  modelAsset('glowing-puppe', 'Glowing Puppe', 'Leuchtende Puppe im Regal.'),
  modelAsset('grillz-poster', 'Grillz Poster', 'Poster mit Grillz-Motiv.'),
  modelAsset('laptop', 'Laptop', 'Laptop auf dem Tisch.'),
  modelAsset('regalbretter', 'Regalbretter', 'Holzbretter im Regal.'),
  modelAsset('regal-bild', 'Regal Bild', 'Bild im Regal.'),
]
