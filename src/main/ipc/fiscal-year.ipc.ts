import { ipcMain } from 'electron'
import { fiscalYearRepository } from '../db/repositories/fiscal-year.repository'
import type { CreateFiscalYearDto, UpdateFiscalYearDto } from '@shared/index'
import { mirrorFiscalYear } from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A fiscal year with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerFiscalYearIpc(): void {
  ipcMain.handle('fiscal-years:getAll', () => fiscalYearRepository.findAll())

  ipcMain.handle('fiscal-years:create', async (_, data: CreateFiscalYearDto) => {
    try {
      const row = fiscalYearRepository.create(data)
      await mirrorFiscalYear.upsert(row)
      return fiscalYearRepository.findById(row.id) ?? row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('fiscal-years:update', async (_, id: number, data: UpdateFiscalYearDto) => {
    try {
      const row = fiscalYearRepository.update(id, data)
      if (row) await mirrorFiscalYear.upsert(row)
      return row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('fiscal-years:delete', async (_, id: number) => {
    await mirrorFiscalYear.remove(id)
    return fiscalYearRepository.delete(id)
  })

  ipcMain.handle('fiscal-years:deleteAll', async (_, ids: number[]) => {
    for (const id of ids) await mirrorFiscalYear.remove(id)
    return fiscalYearRepository.deleteAll(ids)
  })

  ipcMain.handle('fiscal-years:bulkCreate', async (_, items: CreateFiscalYearDto[]) => {
    try {
      const rows = fiscalYearRepository.bulkCreate(items)
      for (const r of rows) await mirrorFiscalYear.upsert(r)
      return rows.map((r) => fiscalYearRepository.findById(r.id) ?? r)
    } catch (err) {
      handleError(err)
    }
  })
}
