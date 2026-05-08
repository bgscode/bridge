import { ipcMain } from 'electron'
import { jobRepository } from '../db/repositories/job.repository'
import { connection as connectionRepo } from '../db/repositories/connection.repository'
import { CreateJobDto, UpdateJobDto, JobRunOptions, JobRow } from '@shared/index'
import { runJob, cancelJob, getRunningJobs, isJobRunning } from '../services/job/job-executor'
import { getSchedulerStatus, rescheduleJob } from '../services/job/job-scheduler'
import { connectUsingBestIp } from '../services/connection/sql-connector'
import {
  stageFile,
  stageBuffer,
  cleanupUploadDir,
  isStagedUploadPath
} from '../services/job/upload-storage'
import { previewActionFile } from '../services/job/action-file-preview'
import {
  mirrorJobConnectionsUpdate,
  mirrorJobCreate,
  mirrorJobUpdate,
  mirrorJobDelete
} from '../services/sync/mirror'

function mergeDefinedJobPatch(base: JobRow, patch: UpdateJobDto): JobRow {
  const next: JobRow = { ...base }

  for (const [key, value] of Object.entries(patch) as [
    keyof UpdateJobDto,
    UpdateJobDto[keyof UpdateJobDto]
  ][]) {
    if (value !== undefined) {
      ;(next as unknown as Record<string, unknown>)[key] = value as unknown
    }
  }

  return next
}

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A job with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

function sanitizePreviewSql(sql: string): string {
  // Replace runtime template placeholders so preview can execute in editor mode.
  return sql.replace(/\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g, 'NULL')
}

function getPreviewColumns(result: unknown, firstRow: Record<string, unknown> | null): string[] {
  if (firstRow) return Object.keys(firstRow)

  const maybeResult = result as {
    recordset?: Array<Record<string, unknown>> & {
      columns?: Record<string, { index?: number; name?: string }>
    }
    columns?: Record<string, { index?: number; name?: string }>
  }

  const columnsMeta = maybeResult.recordset?.columns ?? maybeResult.columns
  if (!columnsMeta) return []

  const entries = Object.entries(columnsMeta).sort(
    (a, b) => (a[1]?.index ?? Number.MAX_SAFE_INTEGER) - (b[1]?.index ?? Number.MAX_SAFE_INTEGER)
  )

  return entries.map(([key, meta], idx) => {
    const name = (meta?.name ?? key ?? '').trim()
    return name.length > 0 ? name : `_col_${idx + 1}`
  })
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
      const existing = jobRepository.findById(id)
      if (!existing) return undefined

      const nextRow = mergeDefinedJobPatch(existing, data)
      await mirrorJobUpdate(nextRow)

      const row = jobRepository.update(id, data)
      return row
    } catch (error) {
      handleError(error)
    }
  })

  ipcMain.handle('jobs:updateConnections', async (_, id: number, connectionIds: number[]) => {
    try {
      const existing = jobRepository.findById(id)
      if (!existing) return undefined

      const uniqueConnectionIds = Array.from(
        new Set(
          (Array.isArray(connectionIds) ? connectionIds : []).filter(
            (value): value is number => Number.isInteger(value) && value > 0
          )
        )
      )

      for (const connectionId of uniqueConnectionIds) {
        if (!connectionRepo.findById(connectionId)) {
          throw new Error(`Connection not found: ${connectionId}`)
        }
      }

      const nextRow = {
        ...existing,
        connection_ids: uniqueConnectionIds
      }

      await mirrorJobConnectionsUpdate(nextRow)

      const row = jobRepository.update(id, { connection_ids: uniqueConnectionIds })

      if (!row) {
        return undefined
      }

      return jobRepository.findById(id) ?? row
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

  // ── SQL Column Preview (runs TOP 1 on a single connection) ─────────────────
  ipcMain.handle(
    'jobs:previewQuery',
    async (
      _,
      connectionId: number,
      sql: string
    ): Promise<{ columns: string[]; firstRow: Record<string, unknown> | null }> => {
      const conn = connectionRepo.findById(connectionId)
      if (!conn) throw new Error('Connection not found')

      const trimmed = sanitizePreviewSql(sql.trim().replace(/;+\s*$/g, ''))
      if (!trimmed) {
        return { columns: [], firstRow: null }
      }

      // Keep the original SELECT shape (no derived-table wrapper) to avoid
      // "No column name was specified" errors for unnamed expressions.
      const previewSql = `SET NOCOUNT ON; SET ROWCOUNT 1; ${trimmed}; SET ROWCOUNT 0;`

      let connected: Awaited<ReturnType<typeof connectUsingBestIp>> | null = null
      try {
        connected = await connectUsingBestIp(conn, 15, 15)
        const result = await connected.pool.request().query(previewSql)
        const firstRow = (result.recordset?.[0] as Record<string, unknown>) ?? null
        const columns = getPreviewColumns(result, firstRow)
        return { columns, firstRow }
      } finally {
        connected?.pool.close().catch(() => {})
      }
    }
  )
}
