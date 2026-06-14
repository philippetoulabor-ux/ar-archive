import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const modelsDir = join(root, 'public', 'models')

const assets = [
  { file: 'astronaut.glb', minBytes: 100_000, type: 'glb' },
  { file: 'astronaut.usdz', minBytes: 100_000, type: 'usdz' },
  { file: 'robot.glb', minBytes: 10_000, type: 'glb' },
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
console.log('  [ ] iPhone/iPad: https://<your-ip>:5173 → Astronaut → In AR ansehen → Quick Look')
console.log('  [ ] Android:     https://<your-ip>:5173 → Astronaut → In AR ansehen → Scene Viewer/WebXR')
console.log('  [ ] Robot model: 3D preview works; AR on Android only (no USDZ)')
console.log('')

if (failed) {
  process.exit(1)
}

console.log('All assets verified.')
