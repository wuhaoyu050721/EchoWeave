import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { filterProxyRequestHeaders, validateProxyTarget } from './src/platform/browser/proxy-rules.js'

function aiProxyPlugin() {
  return {
    name: 'local-ai-proxy',
    configureServer(server) {
      server.middlewares.use('/__ai_proxy', async (request, response) => {
        try {
          const target = validateProxyTarget(request.headers['x-ai-target-url'])
          const chunks = []
          for await (const chunk of request) {
            chunks.push(chunk)
          }
          const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks)
          const controller = new AbortController()
          response.on('close', () => {
            if (!response.writableEnded) controller.abort()
          })
          const upstream = await fetch(target, {
            method: request.method,
            headers: filterProxyRequestHeaders(request.headers),
            body,
            signal: controller.signal,
            redirect: 'follow'
          })

          response.statusCode = upstream.status
          for (const [name, value] of upstream.headers) {
            if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
              response.setHeader(name, value)
            }
          }
          if (!upstream.body) {
            response.end()
            return
          }
          for await (const chunk of upstream.body) {
            response.write(Buffer.from(chunk))
          }
          response.end()
        } catch (error) {
          if (response.headersSent) {
            response.end()
            return
          }
          response.statusCode = error?.name === 'AbortError' ? 499 : 502
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: { message: error?.message || '本地模型代理请求失败' } }))
        }
      })
    }
  }
}

function staticAssetsPlugin() {
  return {
    name: 'copy-static-assets',
    apply: 'build',
    async writeBundle(outputOptions) {
      const outputDirectory = resolve(outputOptions.dir || 'dist-preview')
      await cp(resolve('static'), resolve(outputDirectory, 'static'), { recursive: true })
    }
  }
}

export default defineConfig({
  plugins: [
    aiProxyPlugin(),
    staticAssetsPlugin(),
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => ['view', 'text', 'scroll-view', 'picker'].includes(tag)
        }
      }
    })
  ],
  server: {
    host: '127.0.0.1'
  },
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'preview/index.html'
    }
  }
})
