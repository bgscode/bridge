import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('connections:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('connections:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('connections:delete', id)
  },
  groups: {
    getAll: () => ipcRenderer.invoke('groups:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('groups:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('groups:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('groups:delete', id)
  },
  stores: {
    getAll: () => ipcRenderer.invoke('stores:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('stores:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('stores:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('stores:delete', id)
  },
  fiscalYears: {
    getAll: () => ipcRenderer.invoke('fiscal-years:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('fiscal-years:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('fiscal-years:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('fiscal-years:delete', id)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
