import type { WebContents } from 'electron'
import fs from 'fs'
import type { ConnectionRow, JobRow, JobProgress } from '@shared/index'
import { jobRepository } from '../../db/repositories/job.repository'
import { connection as connectionRepo } from '../../db/repositories/connection.repository'
import { settingsRepo } from '../../db/repositories/settings.repository'
import { connectUsingBestIp } from '../connection/sql-connector'
import { readActionFileRows } from './action-file-preview'
import { buildActionBatchPlan, type ActionWriteMode } from './action-batch-writer'

interface ActionJobConfig {
  filePath: string
  table: string
  mode: ActionWriteMode
  keyColumns: string[]
  batchSize: number
  sheetName?: string
  columnMapping?: Record<string, string>
}

function emit(webContents: WebContents, progress: JobProgress): void {
  try {
    if (!webContents.isDestroyed()) {
      webContents.send('jobs:progress', progress)
    }
  } catch {
    // Window may be closed.
  }
}

function parseActionJobConfig(job: JobRow): ActionJobConfig {
  if (!job.destination_config) {
    throw new Error('Action job config missing. Select an action file and target table.')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(job.destination_config)
  } catch {
    throw new Error('Action job destination config is invalid JSON')
  }

  const modeRaw = String(parsed.mode ?? 'upsert').toLowerCase()
  const mode: ActionWriteMode =
    modeRaw === 'insert' || modeRaw === 'update' || modeRaw === 'upsert' ? modeRaw : 'upsert'

  const keyColumns = Array.isArray(parsed.keyColumns)
    ? parsed.keyColumns.map((v) => String(v).trim()).filter(Boolean)
    : []

  const batchSizeNum = Number(parsed.batchSize)
  const batchSize = Number.isFinite(batchSizeNum)
    ? Math.max(100, Math.min(2000, batchSizeNum))
    : 1000

  const filePath = String(parsed.filePath ?? parsed.stagedPath ?? '').trim()
  const table = String(parsed.table ?? parsed.targetTable ?? job.sql_query?.[0] ?? '').trim()

  if (!filePath) {
    throw new Error('Action input file path missing in job config')
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Action input file not found: ${filePath}`)
  }
  if (!table) {
    throw new Error('Action target table missing in job config')
  }

  const columnMapping: Record<string, string> =
    parsed.columnMapping && typeof parsed.columnMapping === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.columnMapping as Record<string, unknown>)
            .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])
            .filter(([k, v]) => k && v)
        )
      : {}

  return {
    filePath,
    table,
    mode,
    keyColumns,
    batchSize,
    sheetName: typeof parsed.sheetName === 'string' ? parsed.sheetName : undefined,
    columnMapping
  }
}

function mapRowsToTargetColumns(
  sourceHeaders: string[],
  sourceRows: Record<string, unknown>[],
  mapping: Record<string, string>
): { targetHeaders: string[]; rows: Record<string, unknown>[] } {
  const seen = new Set<string>()
  const headerPairs: Array<{ source: string; target: string }> = []
  // When an explicit mapping is provided we only write the columns the user mapped.
  // When mapping is empty we fall back to identity for every source column.
  const explicit = Object.keys(mapping).length > 0

  for (const source of sourceHeaders) {
    const mapped = explicit ? (mapping[source] ?? '').trim() : source
    if (!mapped) continue
    if (seen.has(mapped)) continue
    seen.add(mapped)
    headerPairs.push({ source, target: mapped })
  }

  if (headerPairs.length === 0) {
    throw new Error('No mapped columns found in action file')
  }

  const rows = sourceRows.map((src) => {
    const out: Record<string, unknown> = {}
    for (const pair of headerPairs) {
      out[pair.target] = src[pair.source] ?? null
    }
    return out
  })

  return {
    targetHeaders: headerPairs.map((p) => p.target),
    rows
  }
}

export async function runActionJob(jobId: number, webContents: WebContents): Promise<JobProgress> {
  const job = jobRepository.findById(jobId)
  if (!job) throw new Error(`Job #${jobId} not found`)

  const settings = settingsRepo.getAll()
  const timeoutSec = Math.max(5, settings.job_query_timeout)

  const connIds = Array.isArray(job.connection_ids) ? job.connection_ids : []
  const selectedConnections = connIds
    .map((id) => connectionRepo.findById(id))
    .filter((c): c is ConnectionRow => c !== undefined)

  const connections = job.online_only
    ? selectedConnections.filter((conn) => conn.status === 'online')
    : selectedConnections

  if (connections.length === 0) {
    throw new Error(
      job.online_only
        ? 'No online connections available for this action job'
        : 'No valid connections found for this action job'
    )
  }

  const startedAt = new Date().toISOString()
  const progress: JobProgress = {
    job_id: jobId,
    job_name: job.name,
    status: 'running',
    total_connections: connections.length,
    completed_connections: 0,
    failed_connections: 0,
    total_rows: 0,
    started_at: startedAt,
    finished_at: null,
    connections: connections.map((conn) => ({
      connection_id: conn.id,
      connection_name: conn.name,
      status: 'pending',
      rows: 0,
      error: null,
      started_at: null,
      finished_at: null
    })),
    error: null,
    output_path: null,
    adaptive: null
  }

  emit(webContents, progress)
  jobRepository.update(jobId, { status: 'running' } as Partial<JobRow>)

  try {
    const config = parseActionJobConfig(job)
    const fileData = await readActionFileRows(config.filePath, { sheetName: config.sheetName })
    const mapped = mapRowsToTargetColumns(
      fileData.headers,
      fileData.rows,
      config.columnMapping ?? {}
    )

    if (mapped.rows.length === 0) {
      throw new Error('Action file has no data rows after mapping')
    }

    const inferredKeyColumns =
      config.keyColumns.length > 0
        ? config.keyColumns
        : mapped.targetHeaders.includes('id')
          ? ['id']
          : [mapped.targetHeaders[0]]

    // Run connections in parallel with a bounded worker pool so that a job
    // against many connections doesn't serialize end-to-end.
    const maxParallel = Math.max(
      1,
      Math.min(Number(settings.job_concurrent_connections) || 5, connections.length)
    )

    let cursor = 0
    const runOne = async (index: number): Promise<void> => {
      const conn = connections[index]
      const connProgress = progress.connections[index]
      if (!conn || !connProgress) return
      connProgress.status = 'connecting'
      connProgress.started_at = new Date().toISOString()
      emit(webContents, progress)

      let connected: Awaited<ReturnType<typeof connectUsingBestIp>> | null = null
      try {
        connected = await connectUsingBestIp(conn, timeoutSec, timeoutSec)
        connProgress.status = 'querying'
        emit(webContents, progress)

        for (let i = 0; i < mapped.rows.length; i += config.batchSize) {
          const batch = mapped.rows.slice(i, i + config.batchSize)
          if (batch.length === 0) continue

          const plan = buildActionBatchPlan({
            mode: config.mode,
            table: config.table,
            keyColumns: inferredKeyColumns,
            rows: batch
          })

          const request = connected.pool.request()
          for (const [name, value] of Object.entries(plan.params)) {
            request.input(name, value as string | number | boolean | Date | null)
          }
          await request.query(plan.sql)

          connProgress.rows += batch.length
          progress.total_rows += batch.length
          emit(webContents, progress)
        }

        connProgress.status = 'done'
        connProgress.finished_at = new Date().toISOString()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action write failed'
        connProgress.status = 'error'
        connProgress.error = message
        connProgress.finished_at = new Date().toISOString()
        progress.failed_connections++
      } finally {
        progress.completed_connections++
        emit(webContents, progress)
        connected?.pool.close().catch(() => {})
      }
    }

    const worker = async (): Promise<void> => {
      while (cursor < connections.length) {
        const idx = cursor++
        await runOne(idx)
      }
    }

    const workers: Promise<void>[] = []
    for (let i = 0; i < maxParallel; i++) workers.push(worker())
    await Promise.all(workers)

    if (progress.failed_connections === progress.total_connections) {
      progress.status = 'failed'
      progress.error = 'Action job failed for all connections'
    } else if (progress.failed_connections > 0) {
      progress.status = 'success'
      progress.error = `${progress.failed_connections}/${progress.total_connections} connection(s) failed`
    } else {
      progress.status = 'success'
    }
  } catch (error) {
    progress.status = 'failed'
    progress.error = error instanceof Error ? error.message : 'Action job execution failed'
  }

  progress.finished_at = new Date().toISOString()
  jobRepository.update(jobId, {
    status: progress.status === 'cancelled' ? 'failed' : progress.status,
    last_run_at: progress.finished_at,
    last_error: progress.error
  } as Partial<JobRow>)

  emit(webContents, progress)
  return progress
}

export default runActionJob
