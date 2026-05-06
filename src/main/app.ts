import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { bindWindowIpc, registerAllIpc } from './ipc'
import {
  startConnectionMonitor,
  stopConnectionMonitor
} from './services/connection/connection-monitor'
import { startScheduler, stopScheduler } from './services/job/job-scheduler'

function createAndWireMainWindow(): BrowserWindow {
  const mainWindow = createMainWindow()

  bindWindowIpc(mainWindow)

  mainWindow.webContents.once('did-finish-load', () => {
    stopConnectionMonitor()
    startConnectionMonitor(mainWindow.webContents)
    startScheduler(mainWindow.webContents)
  })

  mainWindow.on('closed', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      stopConnectionMonitor()
      stopScheduler()
    }
  })

  return mainWindow
}

export async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.bridge')

  // Global safety net: never let a stray error or rejection kill the main
  // process. We log it and keep the app responsive — individual operations
  // still surface errors via their own IPC error paths.
  process.on('uncaughtException', (err) => {
    // Suppress known tedious library bug: connection reaches 'Final' state
    // then fires a belated socketError event that the state machine can't
    // handle. It is entirely harmless — the connection is already closed.
    if (err.message?.includes("No event 'socketError' in state 'Final'")) return
    console.error('[main] uncaughtException:', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection:', reason)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAllIpc()
  createAndWireMainWindow()

  app.on('before-quit', () => {
    stopConnectionMonitor()
    stopScheduler()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAndWireMainWindow()
    }
  })
}
