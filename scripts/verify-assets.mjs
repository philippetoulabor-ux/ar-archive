import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const modelsDir = join(root, 'public', 'models')

const assets = [
  { file: 'middleman.glb', minBytes: 10_000, type: 'glb' },
  { file: 'ls-candle.glb', minBytes: 10_000, type: 'glb' },
  { file: 'alien-chair.glb', minBytes: 10_000, type: 'glb' },
  { file: 'x-bock-couch.glb', minBytes: 10_000, type: 'glb' },
  { file: 'weblampe.glb', minBytes: 10_000, type: 'glb' },
  { file: 'speaker-module.glb', minBytes: 10_000, type: 'glb' },
  { file: 'glowing-puppe.glb', minBytes: 10_000, type: 'glb' },
  { file: 'grillz-poster.glb', minBytes: 10_000, type: 'glb' },
  { file: 'laptop.glb', minBytes: 10_000, type: 'glb' },
  { file: 'regalbretter.glb', minBytes: 10_000, type: 'glb' },
  { file: 'regal-bild.glb', minBytes: 10_000, type: 'glb' },
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
