import { ipcMain } from 'electron'
import { jobRepository } from '../db/repositories/job.repository'
import { CreateJobDto, UpdateJobDto, JobRunOptions } from '@shared/index'
import { runJob, cancelJob, getRunningJobs, isJobRunning } from '../services/job/job-executor'
import { getSchedulerStatus, rescheduleJob } from '../services/job/job-scheduler'
import {
  stageFile,
  stageBuffer,
  cleanupUploadDir,
  isStagedUploadPath
} from '../services/job/upload-storage'
import { previewActionFile } from '../services/job/action-file-preview'
import { mirrorJobCreate, mirrorJobUpdate, mirrorJobDelete } from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A job with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerJobIpc(): void {
  ipcMain.handle('jobs:getAll', () => {
    try {
      return jobRepository.findAll()
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:create', async (_, data: CreateJobDto) => {
    try {
      const row = jobRepository.create(data)
      await mirrorJobCreate(row)
      return jobRepository.findById(row.id) ?? row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:bulkCreate', async (_, data: CreateJobDto[]) => {
    try {
      const rows = jobRepository.bulkCreate(data)
      for (const r of rows) await mirrorJobCreate(r)
      return rows.map((r) => jobRepository.findById(r.id) ?? r)
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:update', async (_, id: number, data: UpdateJobDto) => {
    try {
      const row = jobRepository.update(id, data)
      if (row) await mirrorJobUpdate(row)
      return row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:delete', async (_, id: number) => {
    try {
      await mirrorJobDelete(id)
      return jobRepository.delete(id)
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:deleteAll', async (_, ids: number[]) => {
    try {
      for (const id of ids) await mirrorJobDelete(id)
      return jobRepository.deleteAll(ids)
    } catch (error) {
      handleError(error)
    }
  })

  // ── Job Execution ──────────────────────────────────────────────────────────

  ipcMain.handle('jobs:run', async (event, jobId: number, options?: JobRunOptions) => {
    try {
      return await runJob(jobId, event.sender, options)
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:cancel', (event, jobId: number) => {
    const cancelled = cancelJob(jobId)
    // Push an immediate progress snapshot so the UI flips to "cancelled"
    // without waiting for the executor's throttled emit.
    if (cancelled) {
      const live = getRunningJobs().find((p) => p.job_id === jobId)
      if (live && !event.sender.isDestroyed()) {
        event.sender.send('jobs:progress', live)
      }
    }
    return cancelled
  })

  ipcMain.handle('jobs:isRunning', (_, jobId: number) => {
    return isJobRunning(jobId)
  })

  ipcMain.handle('jobs:getRunning', () => {
    return getRunningJobs()
  })

  // ── Scheduler ──────────────────────────────────────────────────────────────

  ipcMain.handle('jobs:schedulerStatus', () => {
    return getSchedulerStatus()
  })

  ipcMain.handle('jobs:reschedule', (_, jobId: number) => {
    rescheduleJob(jobId)
    return true
  })

  // ── File upload staging for Action Jobs ─────────────────────────────────
  ipcMain.handle('jobs:stageUpload', async (_, jobId: number | null, srcPath: string) => {
    try {
      return await stageFile(jobId, srcPath)
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle(
    'jobs:stageUploadBuffer',
    async (_, jobId: number | null, filename: string, buffer: Uint8Array) => {
      try {
        const buf = Buffer.from(buffer)
        return await stageBuffer(jobId, filename, buf)
      } catch (error) {
        handleError(error)
      }
    }
  )

  ipcMain.handle('jobs:cleanupStaged', async (_, stagedPath: string) => {
    try {
      if (!isStagedUploadPath(stagedPath)) {
        throw new Error('Invalid staged file path')
      }
      await cleanupUploadDir(stagedPath)
      return true
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle(
    'jobs:previewStagedFile',
    async (_, stagedPath: string, sheetName?: string, sampleRows?: number) => {
      try {
        if (!isStagedUploadPath(stagedPath)) {
          throw new Error('Invalid staged file path')
        }
        return await previewActionFile(stagedPath, { sheetName, sampleRows })
      } catch (error) {
        handleError(error)
      }
    }
  )
}
