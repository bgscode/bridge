import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
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
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/types')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
