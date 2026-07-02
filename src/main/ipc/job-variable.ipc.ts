import { ipcMain } from 'electron'
import { jobVariableRepository } from '../db/repositories/job-variable.repository'
import { jobRepository } from '../db/repositories/job.repository'
import type { CreateJobVariableDto, UpdateJobVariableDto } from '@shared/index'
import { canEditJobVariables } from '../services/auth-context'
import {
  mirrorJobVariableCreate,
  mirrorJobVariableDelete,
  mirrorJobVariableDeleteConnectionValues,
  mirrorJobVariableSetValue,
  mirrorJobVariableSetJobWideValue,
  mirrorJobVariableUpdate
} from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A variable with this name already exists for this job.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

function assertCanEditJob(jobId: number): void {
  const job = jobRepository.findById(jobId)
  if (!canEditJobVariables(job?.remote_id ?? null)) {
    throw new Error('You do not have permission to edit variables for this job.')
  }
}

function assertCanEditVariable(variableId: number): void {
  const variable = jobVariableRepository.findById(variableId)
  if (!variable) throw new Error('Variable not found.')
  assertCanEditJob(variable.job_id)
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
      assertCanEditJob(data.job_id)
      const row = jobVariableRepository.create(data)
      await mirrorJobVariableCreate(row)
      return jobVariableRepository.findById(row.id) ?? row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('job-variables:update', async (_, id: number, data: UpdateJobVariableDto) => {
    try {
      assertCanEditVariable(id)
      const row = jobVariableRepository.update(id, data)
      if (row) await mirrorJobVariableUpdate(row)
      return row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('job-variables:delete', async (_, id: number) => {
    try {
      assertCanEditVariable(id)
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
        assertCanEditVariable(jobVariableId)
        jobVariableRepository.setValue(jobVariableId, connectionId, value)
        await mirrorJobVariableSetValue(jobVariableId, connectionId, value)
        return true
      } catch (error) {
        handleError(error)
      }
    }
  )

  ipcMain.handle(
    'job-variables:setJobValue',
    async (_, jobVariableId: number, connectionIds: number[], value: string) => {
      try {
        assertCanEditVariable(jobVariableId)
        const variable = jobVariableRepository.findById(jobVariableId)
        if (!variable) throw new Error('Variable not found.')
        jobVariableRepository.setJobWideValue(jobVariableId, connectionIds, value)
        await mirrorJobVariableSetJobWideValue(jobVariableId, connectionIds, value)
        return jobVariableRepository.findById(jobVariableId)
      } catch (error) {
        handleError(error)
      }
    }
  )

  ipcMain.handle(
    'job-variables:deleteConnectionValues',
    async (_, jobId: number, connectionId: number) => {
      try {
        assertCanEditJob(jobId)
        await mirrorJobVariableDeleteConnectionValues(jobId, connectionId)
        jobVariableRepository.deleteConnectionValues(jobId, connectionId)
        return true
      } catch (error) {
        handleError(error)
      }
    }
  )
}
