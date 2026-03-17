import { ipcMain } from 'electron'
import { storeRepository } from '../db/repositories/store.repository'
import type { CreateStoreDto, UpdateStoreDto } from '@shared/index'

export function registerStoreIpc(): void {
  ipcMain.handle('stores:getAll', () => storeRepository.findAll())

  ipcMain.handle('stores:create', (_, data: CreateStoreDto) => storeRepository.create(data))

  ipcMain.handle('stores:update', (_, id: number, data: UpdateStoreDto) =>
    storeRepository.update(id, data)
  )

  ipcMain.handle('stores:delete', (_, id: number) => storeRepository.delete(id))
}
