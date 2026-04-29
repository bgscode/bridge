import { ipcMain, BrowserWindow } from 'electron'
import { settingsRepo } from '../db/repositories/settings.repository'
import { restartMonitor } from '../services/connection/connection-monitor'
import type { AppSettings } from '@shared/index'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:getAll', () => settingsRepo.getAll())

  ipcMain.handle('settings:setMany', (_, data: Partial<AppSettings>) => {
    const updated = settingsRepo.setMany(data)
    // Restart monitor so new settings take effect immediately
    const win = BrowserWindow.getFocusedWindow()
    if (win) restartMonitor(win.webContents)
    return updated
  })
}
