import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { windowConfig } from './window.config'


export function createMainWindow(): BrowserWindow {
    const mainWindow = new BrowserWindow(windowConfig)

    mainWindow.on('ready-to-show', () => mainWindow.show())

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
       shell.openExternal(url)
       return { action: 'deny' }
    })

    if(is.dev && process.env.ELECTRON_RENDERER_URL){
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    }else{
        mainWindow.loadFile(join(__dirname, '../../renderer/index.html'))
    }

    return mainWindow
}