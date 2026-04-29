import { BrowserWindow } from 'electron'
import { bindWindowIpcEvents, registerWindowIpc } from './window.ipc'
import { registerConnectionIpc } from './connection.ipc'
import { registerGroupIpc } from './group.ipc'
import { registerJobGroupIpc } from './job-group.ipc'
import { registerStoreIpc } from './store.ipc'
import { registerFiscalYearIpc } from './fiscal-year.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerJobIpc } from './job.ipc'
import { registerCombinerIpc } from './combiner.ipc'
import { registerSyncIpc } from './sync.ipc'
import { registerAuthIpc } from './auth.ipc'

export function registerAllIpc(): void {
  registerWindowIpc()
  registerAuthIpc()
  registerConnectionIpc()
  registerJobIpc()
  registerGroupIpc()
  registerJobGroupIpc()
  registerStoreIpc()
  registerFiscalYearIpc()
  registerSettingsIpc()
  registerCombinerIpc()
  registerSyncIpc()
}

export function bindWindowIpc(window: BrowserWindow): void {
  bindWindowIpcEvents(window)
}
