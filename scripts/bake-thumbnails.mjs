/**
 * Render static WebP chip previews from each GLB (once, offline).
 *
 * Usage: npm run bake-thumbs
 * Requires: playwright (+ chromium). Installs on first run via npx if missing.
 */
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const root = join(import.meta.dirname, '..')
const modelsDir = join(root, 'public', 'models')
const thumbsDir = join(modelsDir, 'thumbs')
const threeRoot = join(root, 'node_modules', 'three')

const MODELS = [
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

const SIZE = 256
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}

const bakePageHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bake AR thumbs</title>
    <style>
      html, body { margin: 0; background: #141414; }
      canvas { display: block; width: ${SIZE}px; height: ${SIZE}px; }
    </style>
  </head>
  <body>
    <canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
    <script type="importmap">
      {
        "imports": {
          "three": "/three/build/three.module.js",
          "three/addons/": "/three/examples/jsm/"
        }
      }
    </script>
    <script type="module">
      import * as THREE from 'three'
      import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

      function patchArMaterials(model) {
        model.traverse((child) => {
          if (!(child.isMesh)) return
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material]
          for (const material of materials) {
            if (!material || material.type !== 'MeshStandardMaterial') continue
            const name = material.name
            if (name === 'Material_0.007' || child.name === 'Mesh_0.001') {
              material.emissive.set(1, 1, 1)
              material.emissiveIntensity = 6
              material.toneMapped = false
              if (material.emissiveMap) {
                material.emissiveMap.colorSpace = THREE.SRGBColorSpace
              }
            }
            if (name === '10.6.2024_0' || child.name === 'ls-candle') {
              if (material.map) {
                material.emissiveMap = material.map
                material.emissive.set(1, 0.7, 0.35)
                material.emissiveIntensity = 0.6
              }
            }
            if (name === 'Material_0.005' || child.name === 'glowing_puppe') {
              if (material.map) {
                material.emissiveMap = material.map
                material.emissive.set(1, 0.85, 0.7)
                material.emissiveIntensity = 1.8
              }
            }
            if (name === 'Material') {
              material.emissive.set(0, 0, 0)
              material.emissiveIntensity = 1
              material.emissiveMap = null
            }
            material.needsUpdate = true
          }
        })
      }

      function fitModelInView(model) {
        model.updateWorldMatrix(true, true)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z, 1e-4)
        // Fill most of the chip; leave a little margin for border-radius.
        const scale = 0.94 / maxDim
        model.scale.setScalar(scale)
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
        model.updateWorldMatrix(true, true)
      }

      function disposeObject(root) {
        root.traverse((child) => {
          if (child.geometry) child.geometry.dispose()
          const mats = child.material
            ? Array.isArray(child.material)
              ? child.material
              : [child.material]
            : []
          for (const mat of mats) {
            if (!mat) continue
            for (const key of Object.keys(mat)) {
              const value = mat[key]
              if (value && value.isTexture) value.dispose()
            }
            mat.dispose()
          }
        })
      }

      const canvas = document.getElementById('c')
      const loader = new GLTFLoader()

      window.__bakeThumb = async (glbUrl) => {
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xffffff)

        // Wide FOV + farther camera = reliable margins for tall/wide models.
        const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100)
        camera.position.set(1.15, 0.75, 2.35)
        camera.lookAt(0, 0, 0)

        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: true,
        })
        renderer.setPixelRatio(1)
        renderer.setSize(${SIZE}, ${SIZE}, false)
        renderer.outputColorSpace = THREE.SRGBColorSpace

        scene.add(new THREE.AmbientLight(0xffffff, 0.85))
        const key = new THREE.DirectionalLight(0xffffff, 1.3)
        key.position.set(2, 3, 2)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0x88aaff, 0.35)
        fill.position.set(-2, 0, 1)
        scene.add(fill)

        const gltf = await loader.loadAsync(glbUrl)
        patchArMaterials(gltf.scene)
        fitModelInView(gltf.scene)
        scene.add(gltf.scene)
        renderer.render(scene, camera)

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
            'image/webp',
            0.82,
          )
        })

        disposeObject(gltf.scene)
        renderer.dispose()

        const buffer = await blob.arrayBuffer()
        return Array.from(new Uint8Array(buffer))
      }

      window.__bakeReady = true
    </script>
  </body>
</html>`

function contentType(filePath) {
  return MIME[extname(filePath)] ?? 'application/octet-stream'
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (url.pathname === '/' || url.pathname === '/bake') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(bakePageHtml)
        return
      }

      let filePath = null
      if (url.pathname.startsWith('/three/')) {
        filePath = join(threeRoot, url.pathname.slice('/three/'.length))
      } else if (url.pathname.startsWith('/models/')) {
        filePath = join(modelsDir, url.pathname.slice('/models/'.length))
      }

      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404)
        res.end('not found')
        return
      }

      res.writeHead(200, { 'Content-Type': contentType(filePath) })
      res.end(readFileSync(filePath))
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

async function loadPlaywright() {
  try {
    const require = createRequire(import.meta.url)
    return require('playwright')
  } catch {
    console.log('playwright not found locally — launching via npx…')
  }

  // Dynamic import from a resolved npx cache is unreliable; prefer local install.
  const { spawnSync } = await import('node:child_process')
  const install = spawnSync(
    'npm',
    ['install', '--no-save', '--no-package-lock', 'playwright'],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (install.status !== 0) {
    throw new Error('Failed to install playwright. Run: npm i -D playwright')
  }
  const require = createRequire(import.meta.url)
  return require('playwright')
}

async function main() {
  if (!existsSync(threeRoot)) {
    throw new Error('three is not installed. Run npm install in apps/ar-archive')
  }

  mkdirSync(thumbsDir, { recursive: true })

  const playwright = await loadPlaywright()
  const { chromium } = playwright
  const { server, port } = await startServer()
  const base = `http://127.0.0.1:${port}`

  console.log(`Bake server on ${base}`)

  const browser = await chromium.launch({
    headless: true,
    // Prefer system Chrome — Playwright's bundled browser cache is flaky in CI/sandbox.
    channel: existsSync('/Applications/Google Chrome.app')
      ? 'chrome'
      : undefined,
  })
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  })

  await page.goto(`${base}/bake`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__bakeReady === true)

  let failed = false
  for (const id of MODELS) {
    const glbPath = join(modelsDir, `${id}.glb`)
    if (!existsSync(glbPath)) {
      console.error(`FAIL ${id}: missing ${id}.glb`)
      failed = true
      continue
    }

    process.stdout.write(`Baking ${id}… `)
    try {
      const bytes = await page.evaluate(async (glbUrl) => {
        return window.__bakeThumb(glbUrl)
      }, `${base}/models/${id}.glb`)

      const out = join(thumbsDir, `${id}.webp`)
      writeFileSync(out, Buffer.from(bytes))
      console.log(`OK (${(bytes.length / 1024).toFixed(1)} KB)`)
    } catch (error) {
      failed = true
      console.error(`FAIL`)
      console.error(error)
    }
  }

  await browser.close()
  server.close()

  if (failed) process.exit(1)
  console.log(`\nWrote ${MODELS.length} thumbs → public/models/thumbs/`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
