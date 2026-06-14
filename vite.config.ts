import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const root = fileURLToPath(new URL('.', import.meta.url))

function serveUsdz(staticRoot: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = decodeURIComponent(req.url?.split('?')[0] ?? '')
    if (!pathname.endsWith('.usdz')) {
      next()
      return
    }

    const filePath = normalize(join(staticRoot, pathname))
    const rootPath = normalize(staticRoot)

    if (!filePath.startsWith(rootPath) || !existsSync(filePath)) {
      next()
      return
    }

    const data = readFileSync(filePath)
    res.statusCode = 200
    res.setHeader('Content-Type', 'model/vnd.usdz+zip')
    res.setHeader('Content-Disposition', 'inline; filename="model.usdz"')
    res.setHeader('Content-Length', String(data.length))
    res.setHeader('Cache-Control', 'no-cache')
    res.end(data)
  }
}

function usdzQuickLookPlugin(): Plugin {
  return {
    name: 'usdz-quick-look-mime',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(serveUsdz(join(root, 'public')))
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveUsdz(join(root, 'dist')))
    },
  }
}

export default defineConfig({
  base: '/ar-archive/',
  plugins: [basicSsl(), usdzQuickLookPlugin()],
  preview: {
    host: true,
  },
  server: {
    host: true,
  },
})
