import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const modelsDir = join(root, 'public', 'models')

const glbIds = [
  'middleman',
  'ls-candle',
  'alien-chair',
  'x-bock-couch',
  'weblampe',
  'speaker-module',
  'glowing-puppe',
  'grillz-poster',
  'laptop',
  'regalbretter',
  'regal-bild',
]

const assets = [
  ...glbIds.map((id) => ({
    file: `${id}.glb`,
    minBytes: 10_000,
    type: 'glb',
  })),
  ...glbIds.map((id) => ({
    file: `thumbs/${id}.webp`,
    minBytes: 200,
    type: 'webp',
  })),
]

let failed = false

for (const asset of assets) {
  const path = join(modelsDir, asset.file)
  try {
    const { size } = statSync(path)
    if (size < asset.minBytes) {
      console.error(`FAIL ${asset.file}: too small (${size} bytes)`)
      failed = true
      continue
    }

    const header = readFileSync(path, { encoding: null }).subarray(0, 4)
    if (asset.type === 'glb') {
      const magic = header.toString('utf8')
      if (magic !== 'glTF') {
        console.error(`FAIL ${asset.file}: invalid GLB magic (${magic})`)
        failed = true
        continue
      }
    }
    if (asset.type === 'webp') {
      const magic = header.toString('ascii')
      // RIFF....WEBP — check RIFF prefix
      if (magic !== 'RIFF') {
        console.error(`FAIL ${asset.file}: invalid WebP magic (${magic})`)
        failed = true
        continue
      }
    }

    console.log(`OK   ${asset.file} (${(size / 1024).toFixed(0)} KB)`)
  } catch {
    console.error(`FAIL ${asset.file}: not found`)
    failed = true
  }
}

console.log('')
console.log('Device test checklist (manual):')
console.log('  [ ] iPhone/iPad: Portal-AR (Kamera-Overlay) für alle Modelle')
console.log('  [ ] Android:     WebXR Raum-AR oder Portal-Fallback')
console.log('  [ ] Alle Modell-Chips laden Vorschau-Thumbnails')
console.log('')

if (failed) {
  process.exit(1)
}

console.log('All assets verified.')
