import { BrowserWindow, shell, nativeImage, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { windowConfig } from './window.config'

export function createMainWindow(): BrowserWindow {
  // Try to find a suitable app icon (prefer icns > png > ico > svg).
  // This tries several candidate paths so the icon appears during development
  // (when paths differ) as well as in packaged builds.
  let iconImage: Electron.NativeImage | undefined

  function tryCreateImage(p: string | undefined): Electron.NativeImage | undefined {
    try {
      if (!p) return undefined
      if (!existsSync(p)) return undefined
      const ext = p.split('.').pop()?.toLowerCase() || ''
      if (ext === 'svg') {
        const svg = readFileSync(p, 'utf8')
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        return nativeImage.createFromDataURL(dataUrl)
      }
      return nativeImage.createFromPath(p)
    } catch (e) {
      return undefined
    }
  }

  const candidates = [
    join(process.cwd(), 'build', 'icon.icns'),
    join(app.getAppPath(), 'build', 'icon.icns'),
    join(__dirname, '../../build/icon.icns'),
    join(process.cwd(), 'build', 'icon_512.png'),
    join(app.getAppPath(), 'build', 'icon_512.png'),
    join(__dirname, '../../build/icon_512.png'),
    join(process.cwd(), 'build', 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(__dirname, '../../build/icon.ico'),
    join(process.cwd(), 'build', 'icon.svg'),
    join(app.getAppPath(), 'build', 'icon.svg'),
    join(__dirname, '../../build/icon.svg')
  ]

  for (const c of candidates) {
    const img = tryCreateImage(c)
    if (img && !img.isEmpty()) {
      iconImage = img
      break
    }
  }

  // On macOS, set the Dock icon as early as possible so the Dock reflects
  // our branding during development instead of the Electron default.
  if (process.platform === 'darwin' && iconImage) {
    try {
      app.dock.setIcon(iconImage)
    } catch (err) {
      // ignore
    }
  }

  const mainWindow = new BrowserWindow({
    ...windowConfig,
    ...(iconImage ? { icon: iconImage } : {})
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../renderer/index.html'))
  }

  // On macOS, also set the dock icon when available so the Dock shows our
  // branding instead of the Electron badge during development.
  if (process.platform === 'darwin' && iconImage) {
    try {
      app.dock.setIcon(iconImage)
    } catch (err) {
      // ignore
    }
  }

  return mainWindow
}
