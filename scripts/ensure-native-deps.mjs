#!/usr/bin/env node
/**
 * Ensures better-sqlite3 (and other native deps) are built for the current
 * OS + Electron ABI. Skips when the .node binary already matches this platform.
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const NODE_BINARY = join(
  ROOT,
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
)

function nativeBinaryMatchesPlatform(filePath) {
  if (!existsSync(filePath)) return false

  let output = ''
  try {
    output = execSync(`file "${filePath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return false
  }

  if (process.platform === 'darwin') return /Mach-O/.test(output)
  if (process.platform === 'win32') return /PE32/.test(output)
  if (process.platform === 'linux') return /ELF/.test(output)
  return true
}

function rebuildNativeDeps() {
  console.log('[native-deps] Rebuilding native modules for Electron…')
  const result = spawnSync('npx', ['electron-builder', 'install-app-deps'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.status !== 0) {
    console.error('[native-deps] Rebuild failed. Try: npx electron-builder install-app-deps')
    process.exit(result.status ?? 1)
  }

  if (!nativeBinaryMatchesPlatform(NODE_BINARY)) {
    console.error('[native-deps] Rebuild finished but binary still mismatches this platform.')
    process.exit(1)
  }

  console.log('[native-deps] Native modules ready.')
}

if (!nativeBinaryMatchesPlatform(NODE_BINARY)) {
  rebuildNativeDeps()
}
