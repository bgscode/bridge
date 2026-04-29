import { ipcMain } from 'electron'
import { setAuthContext } from '../services/auth-context'

export function registerAuthIpc(): void {
  ipcMain.handle('auth:set-context', (_, token: string | null, role: string | null) => {
    setAuthContext(token, role)
  })
}
