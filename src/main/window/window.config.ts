import { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'

const isMac = process.platform === 'darwin'

export const windowConfig: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 800,
  minWidth: 900,
  minHeight: 600,
  show: false,
  autoHideMenuBar: true,
  // macOS: native traffic lights inset under our custom header
  // Windows/Linux: frameless so our own title bar provides drag + controls
  ...(isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 15, y: 15 } }
    : { frame: false }),
  // Transparent only on macOS (Windows transparent + frameless has glitches)
  transparent: isMac,
  backgroundColor: isMac ? undefined : '#0b0b0b',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false
  }
}
