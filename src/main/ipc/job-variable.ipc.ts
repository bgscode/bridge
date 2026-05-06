import { ipcMain } from 'electron'
import { jobVariableRepository } from '../db/repositories/job-variable.repository'
import type { CreateJobVariableDto, UpdateJobVariableDto } from '@shared/index'
import {
  mirrorJobVariableCreate,
  mirrorJobVariableDelete,
  mirrorJobVariableDeleteConnectionValues,
  mirrorJobVariableSetValue,
  mirrorJobVariableUpdate
} from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A variable with this name already exists for this job.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerJobVariableIpc(): void {
  ipcMain.handle('job-variables:getAll', (_, jobId: number) => {
    try {
      return jobVariableRepository.findByJob(jobId)
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('job-variables:create', async (_, data: CreateJobVariableDto) => {
    try {
      const row = jobVariableRepository.create(data)
      await mirrorJobVariableCreate(row)
      return jobVariableRepository.findById(row.id) ?? row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('job-variables:update', async (_, id: number, data: UpdateJobVariableDto) => {
    try {
      const row = jobVariableRepository.update(id, data)
      if (row) await mirrorJobVariableUpdate(row)
      return row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('job-variables:delete', async (_, id: number) => {
    try {
      await mirrorJobVariableDelete(id)
      jobVariableRepository.delete(id)
      return true
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle(
    'job-variables:setValue',
    async (_, jobVariableId: number, connectionId: number, value: string) => {
      try {
        jobVariableRepository.setValue(jobVariableId, connectionId, value)
        await mirrorJobVariableSetValue(jobVariableId, connectionId, value)
        return true
      } catch (error) {
        handleError(error)
      }
    }
  )

  ipcMain.handle(
    'job-variables:deleteConnectionValues',
    async (_, jobId: number, connectionId: number) => {
      try {
        await mirrorJobVariableDeleteConnectionValues(jobId, connectionId)
        jobVariableRepository.deleteConnectionValues(jobId, connectionId)
        return true
      } catch (error) {
        handleError(error)
      }
    }
  )
}
