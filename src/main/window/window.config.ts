import { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'

export const windowConfig: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 800,
  minWidth: 900,
  minHeight: 600,
  show: false,
  autoHideMenuBar: true,
  frame: false,
  transparent: true,
  titleBarStyle: 'hidden',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false
  }
}
