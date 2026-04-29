import { ipcMain } from 'electron'
import { jobGroupRepository } from '../db/repositories/job-group.repository'
import type { CreateJobGroupDto, UpdateJobGroupDto } from '@shared/index'
import { mirrorJobGroup } from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A job group with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerJobGroupIpc(): void {
  ipcMain.handle('job-groups:getAll', () => jobGroupRepository.findAll())

  ipcMain.handle('job-groups:create', async (_, data: CreateJobGroupDto) => {
    try {
      const row = jobGroupRepository.create(data)
      await mirrorJobGroup.upsert(row)
      return jobGroupRepository.findById(row.id) ?? row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('job-groups:bulkCreate', async (_, items: CreateJobGroupDto[]) => {
    try {
      const rows = jobGroupRepository.bulkCreate(items)
      for (const r of rows) await mirrorJobGroup.upsert(r)
      return rows.map((r) => jobGroupRepository.findById(r.id) ?? r)
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('job-groups:update', async (_, id: number, data: UpdateJobGroupDto) => {
    try {
      const row = jobGroupRepository.update(id, data)
      if (row) await mirrorJobGroup.upsert(row)
      return row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('job-groups:delete', async (_, id: number) => {
    await mirrorJobGroup.remove(id)
    return jobGroupRepository.delete(id)
  })

  ipcMain.handle('job-groups:deleteAll', async (_, ids: number[]) => {
    for (const id of ids) await mirrorJobGroup.remove(id)
    return jobGroupRepository.deleteAll(ids)
  })
}
