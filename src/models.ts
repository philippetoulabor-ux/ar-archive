import { asset } from './assets.ts'

export interface ModelAsset {
  id: string
  name: string
  description: string
  glb: string
  usdz?: string
  poster?: string
}

export const models: ModelAsset[] = [
  {
    id: 'middleman',
    name: 'Middleman',
    description: 'Regalfigur aus dem Wohnzimmer.',
    glb: asset('models/middleman.glb'),
  },
  {
    id: 'ls-candle',
    name: 'Lucky Star Kerze',
    description: 'Leuchtende Kerze aus dem Regal.',
    glb: asset('models/ls-candle.glb'),
  },
  {
    id: 'alien-chair',
    name: 'Alien Chair',
    description: 'Stuhl mit Alien-Design.',
    glb: asset('models/alien-chair.glb'),
  },
  {
    id: 'x-bock-couch',
    name: 'X-Bock Couch',
    description: 'Modulare Sitzmöbel-Konstruktion.',
    glb: asset('models/x-bock-couch.glb'),
  },
  {
    id: 'weblampe',
    name: 'Weblampe',
    description: 'Gewebte Lichtskulptur.',
    glb: asset('models/weblampe.glb'),
  },
  {
    id: 'speaker-module',
    name: 'Speaker Module',
    description: 'Lautsprecher-Modul aus dem Soundsystem.',
    glb: asset('models/speaker-module.glb'),
  },
  {
    id: 'glowing-puppe',
    name: 'Glowing Puppe',
    description: 'Leuchtende Puppe im Regal.',
    glb: asset('models/glowing-puppe.glb'),
  },
  {
    id: 'grillz-poster',
    name: 'Grillz Poster',
    description: 'Poster mit Grillz-Motiv.',
    glb: asset('models/grillz-poster.glb'),
  },
  {
    id: 'laptop',
    name: 'Laptop',
    description: 'Laptop auf dem Tisch.',
    glb: asset('models/laptop.glb'),
  },
  {
    id: 'regalbretter',
    name: 'Regalbretter',
    description: 'Holzbretter im Regal.',
    glb: asset('models/regalbretter.glb'),
  },
  {
    id: 'regal-bild',
    name: 'Regal Bild',
    description: 'Bild im Regal.',
    glb: asset('models/regal-bild.glb'),
  },
]
