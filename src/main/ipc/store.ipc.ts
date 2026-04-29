import { ipcMain } from 'electron'
import { storeRepository } from '../db/repositories/store.repository'
import type { CreateStoreDto, UpdateStoreDto } from '@shared/index'
import { mirrorStore } from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A store with this code already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerStoreIpc(): void {
  ipcMain.handle('stores:getAll', () => storeRepository.findAll())

  ipcMain.handle('stores:create', async (_, data: CreateStoreDto) => {
    try {
      const row = storeRepository.create(data)
      await mirrorStore.upsert(row)
      return storeRepository.findById(row.id) ?? row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('stores:bulkCreate', async (_, items: CreateStoreDto[]) => {
    try {
      const rows = storeRepository.bulkCreate(items)
      for (const r of rows) await mirrorStore.upsert(r)
      return rows.map((r) => storeRepository.findById(r.id) ?? r)
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('stores:update', async (_, id: number, data: UpdateStoreDto) => {
    try {
      const row = storeRepository.update(id, data)
      if (row) await mirrorStore.upsert(row)
      return row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('stores:delete', async (_, id: number) => {
    await mirrorStore.remove(id)
    return storeRepository.delete(id)
  })

  ipcMain.handle('stores:deleteAll', async (_, ids: number[]) => {
    for (const id of ids) await mirrorStore.remove(id)
    return storeRepository.deleteAll(ids)
  })
}
