import { BrowserWindow, ipcMain } from 'electron'

export function registerWindowIpc(window: BrowserWindow): void {
  ipcMain.on('window:minimize', () => window.minimize())

  ipcMain.on('window:maximize', () => {
    window.isMaximized() ? window.unmaximize() : window.maximize()
  })

  ipcMain.on('window:close', () => window.close())

  ipcMain.handle('window:isMaximized', () => window.isMaximized())
}
