/**
 * electron-builder cross-compiles Windows from macOS and leaves the host
 * Mach-O better-sqlite3.node inside the Windows app. Swap in the official
 * win32-x64 Electron prebuild before the installer is packed.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')
const abi = require('node-abi')

const ROOT = path.join(__dirname, '..')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const request = (nextUrl) => {
      https
        .get(nextUrl, { headers: { 'User-Agent': 'alam-build' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            request(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`Download failed ${res.statusCode}: ${nextUrl}`))
            return
          }
          res.pipe(file)
          file.on('finish', () => file.close(resolve))
        })
        .on('error', reject)
    }
    request(url)
  })
}

function findNode(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findNode(full)
      if (found) return found
    } else if (entry.name.endsWith('.node')) {
      return full
    }
  }
  return null
}

async function ensureWinSqlite(version, electronAbi) {
  const cacheDir = path.join(ROOT, 'build', 'prebuilds')
  const cached = path.join(cacheDir, `better_sqlite3-v${version}-electron-v${electronAbi}-win32-x64.node`)
  if (fs.existsSync(cached)) return cached

  fs.mkdirSync(cacheDir, { recursive: true })
  const tarPath = path.join(cacheDir, `better-sqlite3-v${version}-electron-v${electronAbi}-win32-x64.tar.gz`)
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-electron-v${electronAbi}-win32-x64.tar.gz`
  console.log('[afterPack] downloading', url)
  await download(url, tarPath)

  const extractDir = path.join(cacheDir, 'extract-win32')
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  execFileSync('tar', ['-xzf', tarPath, '-C', extractDir])

  const found = findNode(extractDir)
  if (!found) throw new Error('Windows better-sqlite3 prebuild did not contain a .node file')
  fs.copyFileSync(found, cached)
  return cached
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const sqliteVersion = require(path.join(ROOT, 'node_modules/better-sqlite3/package.json')).version
  const electronVersion = require(path.join(ROOT, 'node_modules/electron/package.json')).version
  const electronAbi = abi.getAbi(electronVersion, 'electron')
  const src = await ensureWinSqlite(sqliteVersion, electronAbi)

  const kind = execFileSync('file', [src], { encoding: 'utf8' })
  if (!/PE32/.test(kind)) {
    throw new Error(`Windows prebuild is not a Win32 binary: ${kind.trim()}`)
  }

  const dest = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )
  if (!fs.existsSync(dest)) {
    throw new Error(`Packaged better-sqlite3 binary not found at ${dest}`)
  }

  fs.copyFileSync(src, dest)
  console.log('[afterPack] Replaced better_sqlite3.node with win32-x64 Electron prebuild')
}
