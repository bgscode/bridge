import { BrowserWindow } from 'electron'
import { registerWindowIpc } from './windlow.ips'
import { registerConnectionIpc } from './connection.ipc'
import { registerGroupIpc } from './group.ipc'
import { registerStoreIpc } from './store.ipc'
import { registerFiscalYearIpc } from './fiscal-year.ipc'

export function registerAllIpc(window: BrowserWindow): void {
  registerWindowIpc(window)
  registerConnectionIpc()
  registerGroupIpc()
  registerStoreIpc()
  registerFiscalYearIpc()
}
