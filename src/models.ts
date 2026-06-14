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
    id: 'robot',
    name: 'Robot',
    description: 'Kleines Testmodell — lädt schnell auf dem Handy.',
    glb: asset('models/robot.glb'),
  },
  {
    id: 'astronaut',
    name: 'Astronaut',
    description: 'Demo-Modell mit voller AR-Unterstützung (iOS + Android).',
    glb: asset('models/astronaut.glb'),
    usdz: asset('models/astronaut.usdz'),
  },
]
