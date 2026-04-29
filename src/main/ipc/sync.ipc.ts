import { ipcMain, webContents } from 'electron'
import { syncAll, pushOnce } from '../services/sync/sync.service'

export function registerSyncIpc(): void {
  ipcMain.handle('sync:run', async (_evt, token: string) => {
    const result = await syncAll(token)
    for (const wc of webContents.getAllWebContents()) {
      wc.send('sync:completed', result)
    }
    return result
  })

  ipcMain.handle('sync:push-once', async (_evt, token: string) => {
    const result = await pushOnce(token)
    for (const wc of webContents.getAllWebContents()) {
      wc.send('sync:completed', result)
    }
    return result
  })
}
