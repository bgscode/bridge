import { ipcMain } from 'electron'
import { fiscalYearRepository } from '../db/repositories/fiscal-year.repository'
import type { CreateFiscalYearDto, UpdateFiscalYearDto } from '@shared/index'

export function registerFiscalYearIpc(): void {
  ipcMain.handle('fiscal-years:getAll', () => fiscalYearRepository.findAll())

  ipcMain.handle('fiscal-years:create', (_, data: CreateFiscalYearDto) =>
    fiscalYearRepository.create(data)
  )

  ipcMain.handle('fiscal-years:update', (_, id: number, data: UpdateFiscalYearDto) =>
    fiscalYearRepository.update(id, data)
  )

  ipcMain.handle('fiscal-years:delete', (_, id: number) => fiscalYearRepository.delete(id))
}
