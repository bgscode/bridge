import { BrowserWindow, dialog, ipcMain, shell } from 'electron'

export function registerWindowIpc(): void {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    window.isMaximized() ? window.unmaximize() : window.maximize()
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('window:isFullscreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })

  // ── Native file / folder dialogs ──────────────────────────────────────────

  ipcMain.handle(
    'dialog:openFile',
    async (event, opts: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        title: opts.title ?? 'Select File',
        properties: ['openFile'],
        filters: opts.filters ?? [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }]
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  ipcMain.handle('dialog:openFolder', async (event, opts: { title?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: opts.title ?? 'Select Folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // ── Shell operations ──────────────────────────────────────────────────────

  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.on('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}

export function bindWindowIpcEvents(window: BrowserWindow): void {
  window.on('enter-full-screen', () => {
    window.webContents.send('window:fullscreen-change', true)
  })

  window.on('leave-full-screen', () => {
    window.webContents.send('window:fullscreen-change', false)
  })
}
