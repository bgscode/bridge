import { ipcMain } from 'electron'
import { groupRepository } from '../db/repositories/group.repository'
import type { CreateGroupDto, UpdateGroupDto } from '@shared/index'
import { mirrorGroup } from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A group with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerGroupIpc(): void {
  ipcMain.handle('groups:getAll', () => groupRepository.findAll())

  ipcMain.handle('groups:create', async (_, data: CreateGroupDto) => {
    try {
      const row = groupRepository.create(data)
      await mirrorGroup.upsert(row)
      return groupRepository.findById(row.id) ?? row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('groups:bulkCreate', async (_, items: CreateGroupDto[]) => {
    try {
      const rows = groupRepository.bulkCreate(items)
      for (const r of rows) await mirrorGroup.upsert(r)
      return rows.map((r) => groupRepository.findById(r.id) ?? r)
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('groups:update', async (_, id: number, data: UpdateGroupDto) => {
    try {
      const row = groupRepository.update(id, data)
      if (row) await mirrorGroup.upsert(row)
      return row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('groups:delete', async (_, id: number) => {
    await mirrorGroup.remove(id)
    return groupRepository.delete(id)
  })

  ipcMain.handle('groups:deleteAll', async (_, ids: number[]) => {
    for (const id of ids) await mirrorGroup.remove(id)
    return groupRepository.deleteAll(ids)
  })
}
