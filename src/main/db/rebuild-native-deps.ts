import { spawnSync } from 'child_process'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

const REBUILD_ARG = '--bridge-native-rebuild-attempted'
const NODE_BINARY_REL = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'

export function isNativeModuleLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return (
    msg.includes('ERR_DLOPEN_FAILED') ||
    /not valid mach-o/i.test(msg) ||
    /was compiled against a different Node\.js version/i.test(msg) ||
    /module version mismatch/i.test(msg)
  )
}

function nativeBinaryMatchesPlatform(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  let output = ''
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    output = execSync(`file "${filePath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return false
  }

  if (process.platform === 'darwin') return /Mach-O/.test(output)
  if (process.platform === 'win32') return /PE32/.test(output)
  if (process.platform === 'linux') return /ELF/.test(output)
  return true
}

function getAppRoot(): string {
  // Packaged: resources/app.asar.unpacked or resources/app; dev: project root.
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked')
  }
  return join(__dirname, '../../..')
}

/**
 * In development, rebuild native modules once and relaunch when dlopen fails
 * (e.g. Windows-built .node on macOS after copying node_modules).
 */
export function tryAutoRebuildNativeDepsInDev(err: unknown): boolean {
  if (!process.env.ELECTRON_RENDERER_URL) return false
  if (process.argv.includes(REBUILD_ARG)) return false
  if (!isNativeModuleLoadError(err)) return false

  const nodeBinary = join(getAppRoot(), NODE_BINARY_REL)
  if (nativeBinaryMatchesPlatform(nodeBinary)) return false

  console.warn('[db] Native module mismatch detected; rebuilding for Electron…')

  const result = spawnSync('npx', ['electron-builder', 'install-app-deps'], {
    cwd: getAppRoot(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.status !== 0) {
    console.error('[db] Native rebuild failed.')
    return false
  }

  if (!nativeBinaryMatchesPlatform(nodeBinary)) {
    console.error('[db] Native rebuild finished but binary still mismatches this platform.')
    return false
  }

  console.log('[db] Native modules rebuilt; relaunching…')
  const relaunchArgs = process.argv.slice(1).filter((arg) => arg !== REBUILD_ARG)
  relaunchArgs.push(REBUILD_ARG)
  app.relaunch({ args: relaunchArgs })
  app.exit(0)
  return true
}
