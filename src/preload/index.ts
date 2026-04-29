import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    onFullscreenChange: (cb: (isFullscreen: boolean) => void) =>
      ipcRenderer.on('window:fullscreen-change', (_e, data) => cb(data)),
    offFullscreenChange: () => ipcRenderer.removeAllListeners('window:fullscreen-change'),
    platform: process.platform
  },
  dialog: {
    openFile: (opts?: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:openFile', opts ?? {}),
    openFolder: (opts?: { title?: string }) => ipcRenderer.invoke('dialog:openFolder', opts ?? {})
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.send('shell:showItemInFolder', filePath)
  },
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('connections:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('connections:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('connections:update', id, data),
    bulkUpdateCredentials: (
      ids: number[],
      creds: { username?: string; password?: string }
    ) => ipcRenderer.invoke('connections:bulkUpdateCredentials', ids, creds),
    delete: (id: number) => ipcRenderer.invoke('connections:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('connections:deleteAll', ids),
    test: (id: number) => ipcRenderer.invoke('connections:test', id),
    testAll: (ids: number[]) => ipcRenderer.invoke('connections:testAll', ids),
    onTestProgress: (cb: (data: { id: number; status: string; error: string | null }) => void) =>
      ipcRenderer.on('connections:test-progress', (_e, data) => cb(data)),
    offTestProgress: () => ipcRenderer.removeAllListeners('connections:test-progress')
  },
  jobs: {
    getAll: () => ipcRenderer.invoke('jobs:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('jobs:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('jobs:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('jobs:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('jobs:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('jobs:deleteAll', ids),
    run: (id: number, options?: unknown) => ipcRenderer.invoke('jobs:run', id, options),
    cancel: (id: number) => ipcRenderer.invoke('jobs:cancel', id),
    isRunning: (id: number) => ipcRenderer.invoke('jobs:isRunning', id),
    getRunning: () => ipcRenderer.invoke('jobs:getRunning'),
    schedulerStatus: () => ipcRenderer.invoke('jobs:schedulerStatus'),
    reschedule: (id: number) => ipcRenderer.invoke('jobs:reschedule', id),
    onProgress: (cb: (data: unknown) => void) =>
      ipcRenderer.on('jobs:progress', (_e, data) => cb(data)),
    offProgress: () => ipcRenderer.removeAllListeners('jobs:progress'),
    stageUpload: (jobId: number | null, srcPath: string) =>
      ipcRenderer.invoke('jobs:stageUpload', jobId, srcPath),
    stageUploadBuffer: (jobId: number | null, filename: string, buffer: Uint8Array) =>
      ipcRenderer.invoke('jobs:stageUploadBuffer', jobId, filename, buffer),
    cleanupStaged: (stagedPath: string) => ipcRenderer.invoke('jobs:cleanupStaged', stagedPath),
    previewStagedFile: (stagedPath: string, sheetName?: string, sampleRows?: number) =>
      ipcRenderer.invoke('jobs:previewStagedFile', stagedPath, sheetName, sampleRows)
  },
  groups: {
    getAll: () => ipcRenderer.invoke('groups:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('groups:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('groups:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('groups:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('groups:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('groups:deleteAll', ids)
  },
  jobGroups: {
    getAll: () => ipcRenderer.invoke('job-groups:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('job-groups:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('job-groups:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('job-groups:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('job-groups:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('job-groups:deleteAll', ids)
  },
  stores: {
    getAll: () => ipcRenderer.invoke('stores:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('stores:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('stores:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('stores:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('stores:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('stores:deleteAll', ids)
  },
  fiscalYears: {
    getAll: () => ipcRenderer.invoke('fiscal-years:getAll'),
    create: (data: unknown) => ipcRenderer.invoke('fiscal-years:create', data),
    bulkCreate: (items: unknown[]) => ipcRenderer.invoke('fiscal-years:bulkCreate', items),
    update: (id: number, data: unknown) => ipcRenderer.invoke('fiscal-years:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('fiscal-years:delete', id),
    deleteAll: (ids: number[]) => ipcRenderer.invoke('fiscal-years:deleteAll', ids)
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    setMany: (data: unknown) => ipcRenderer.invoke('settings:setMany', data)
  },
  combiner: {
    combine: (options: unknown) => ipcRenderer.invoke('combiner:combine', options)
  },
  sync: {
    run: (token: string) => ipcRenderer.invoke('sync:run', token),
    pushOnce: (token: string) => ipcRenderer.invoke('sync:push-once', token),
    onCompleted: (cb: (result: unknown) => void) => {
      const listener = (_evt: unknown, result: unknown): void => cb(result)
      ipcRenderer.on('sync:completed', listener)
      return () => ipcRenderer.removeListener('sync:completed', listener)
    }
  },
  auth: {
    setContext: (token: string | null, role: string | null) =>
      ipcRenderer.invoke('auth:set-context', token, role)
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
