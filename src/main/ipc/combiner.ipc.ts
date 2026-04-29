import { ipcMain } from 'electron'
import { combineCsvFolder } from '../services/combiner'
import type { CombineCsvFolderOptions } from '@shared/index'

export function registerCombinerIpc(): void {
  ipcMain.handle('combiner:combine', async (_, options: CombineCsvFolderOptions) => {
    try {
      return await combineCsvFolder(options)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to combine CSV folder'
      throw new Error(message)
    }
  })
}
