import { resolve } from 'path'
import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve('src'), '')
  const productionEnv = loadEnv('production', resolve('src'), '')
  const apiUrl =
    productionEnv.BRIDGE_API_URL ?? env.BRIDGE_API_URL ?? 'https://link.yonolight.com/api'

  return {
    main: {
      envDir: resolve('src'),
      define: {
        'process.env.BRIDGE_API_URL': JSON.stringify(apiUrl)
      },
      build: {
        externalizeDeps: true
      },
      resolve: {
        alias: {
          '@shared': resolve('src/types')
        }
      }
    },
    preload: {
      envDir: resolve('src'),
      build: {
        externalizeDeps: true
      },
      resolve: {
        alias: {
          '@shared': resolve('src/types')
        }
      }
    },
    renderer: {
      envDir: resolve('src'),
      define: {
        'import.meta.env.BRIDGE_API_URL': JSON.stringify(apiUrl)
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@': resolve('src/renderer/src'),
          '@shared': resolve('src/types')
        }
      },
      plugins: [react(), tailwindcss()]
    }
  }
})
