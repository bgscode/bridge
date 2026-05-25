import mssql from 'mssql'
import path from 'path'
import fs from 'fs'
import ExcelJS from 'exceljs'
import { app } from 'electron'
import type { WebContents } from 'electron'
import type {
  ConnectionRow,
  JobRow,
  JobProgress,
  JobConnectionProgress,
  JobRunOptions
} from '@shared/index'
import { connectUsingBestIp } from '../connection/sql-connector'
import { connection as connectionRepo } from '../../db/repositories/connection.repository'
import { jobRepository } from '../../db/repositories/job.repository'
import { jobVariableRepository } from '../../db/repositories/job-variable.repository'
import { mirrorJobVariableSetValue } from '../sync/mirror'
import { settingsRepo } from '../../db/repositories/settings.repository'
import { storeRepository } from '../../db/repositories/store.repository'
import { groupRepository } from '../../db/repositories/group.repository'
import { fiscalYearRepository } from '../../db/repositories/fiscal-year.repository'
import { getAuthToken } from '../auth-context'
import { getAdaptiveBrain, type HealthSnapshot } from './adaptive-brain'
import { decideOutputFormat } from './output-decision'
import { runActionJob } from './action-executor'
import { formatUtcToIst } from '../../utils/format-date'
import {
  buildGoogleSheetBucketTargets,
  writeToGoogleSheets,
  type GsheetBucket,
  type GoogleSheetBucketTarget
} from './gsheet-writer'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max rows to buffer per connection before flushing to disk */
const CHUNK_SIZE = 5000
/** Abort a connection if it exceeds this many rows (safety valve) */
const MAX_ROWS_PER_CONNECTION = 20_000_000
/** Append mode on huge datasets is memory-heavy with XLSX merge; switch to fresh file above this */
const APPEND_SAFE_ROW_LIMIT = 200_000
/**
 * Skip in-place workbook loading above this file size to avoid OOM.
 * writeInPlaceExcelReplace returns null so the caller falls back to the
 * streaming writer which never holds the full workbook in heap at once.
 */
const MAX_IN_PLACE_WORKBOOK_BYTES = 200 * 1024 * 1024 // 200 MB

// ─── Running jobs map ─────────────────────────────────────────────────────────

const runningJobs = new Map<number, JobProgress>()
const cancelledJobs = new Set<number>()
const jobRetries = new Map<number, Map<number, number>>()

/**
 * Active SQL resources per running job — used to make cancellation IMMEDIATE.
 * As soon as `cancelJob(id)` is called we (a) flag the cancellation in
 * `cancelledJobs`, (b) abort every open mssql request, and (c) close every
 * open pool. The streaming loop's per-row check then ends in the next tick.
 */
interface JobAbortHandle {
  requests: Set<mssql.Request>
  pools: Set<mssql.ConnectionPool>
}
const jobAbortHandles = new Map<number, JobAbortHandle>()

function registerJobAbortHandle(jobId: number): JobAbortHandle {
  const handle: JobAbortHandle = { requests: new Set(), pools: new Set() }
  jobAbortHandles.set(jobId, handle)
  return handle
}

function clearJobAbortHandle(jobId: number): void {
  jobAbortHandles.delete(jobId)
}

export function getRunningJobs(): JobProgress[] {
  return Array.from(runningJobs.values())
}

export function isJobRunning(jobId: number): boolean {
  return runningJobs.has(jobId)
}

export function cancelJob(jobId: number): boolean {
  if (!runningJobs.has(jobId)) return false
  cancelledJobs.add(jobId)
  // Tear down active SQL work immediately so the executor doesn't keep
  // pulling rows or waiting on a hung server response.
  const handle = jobAbortHandles.get(jobId)
  if (handle) {
    for (const req of handle.requests) {
      try {
        req.cancel()
      } catch {
        // best-effort
      }
    }
    handle.requests.clear()
    for (const pool of handle.pools) {
      pool.close().catch(() => {})
    }
    handle.pools.clear()
  }
  // We deliberately do NOT mutate live.status to 'cancelled' here: the
  // writer must complete with the data already collected, and the final
  // state is decided in `runJob` finalize (which treats cancel as success
  // when at least one connection finished). The UI uses cancelledJobs +
  // adaptive reason for live feedback.
  const live = runningJobs.get(jobId)
  if (live) {
    live.error = live.error ?? 'Job cancelled by user — finishing output…'
  }
  return true
}

// ─── Emit helper ──────────────────────────────────────────────────────────────

/**
 * Returns Desktop/Job_Output/ as the fallback output base directory
 * when the configured destination path is inaccessible (e.g. a mapped network
 * drive or Windows drive letter that doesn't exist on this machine), or when
 * the job has no destination configured at all. Files always land here as a
 * last resort so users never lose a run's output.
 */
function appDesktopBaseDir(): string {
  return path.join(app.getPath('desktop'), 'Job_Output')
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value)
}

function localTemplateFileName(templatePath: string): string {
  let rawName = 'template.xlsx'
  try {
    const parsed = new URL(templatePath)
    const fromUrl = path.basename(decodeURIComponent(parsed.pathname || ''))
    if (fromUrl) rawName = fromUrl
  } catch {
    // fallback name
  }

  const legacyExcelName = rawName.match(/^(.+)\.(xlsx|xlsm|xls)(?:[-_](\d+))?$/i)
  if (legacyExcelName) {
    const [, stem, ext, suffix] = legacyExcelName
    const excelName = `${stem}${suffix ? `-${suffix}` : ''}.${ext}`
    return `_template_${sanitizeFileName(excelName)}`
  }

  const ext = /^\.xls[xm]?$/i.test(path.extname(rawName)) ? path.extname(rawName) : '.xlsx'
  const stem = path.basename(rawName, path.extname(rawName)) || 'template'
  return `_template_${sanitizeFileName(stem)}${ext}`
}

async function fetchTemplateResponse(templatePath: string): Promise<Response> {
  const direct = await fetch(templatePath)
  if (direct.ok) return direct

  const apiBase = process.env.BRIDGE_API_URL
  const token = getAuthToken()
  if (!apiBase || !token) return direct

  const proxied = await fetch(
    `${apiBase}/upload/file?fileUrl=${encodeURIComponent(templatePath)}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  )
  return proxied.ok ? proxied : direct
}

async function resolveMachineLocalTemplatePath(
  templatePath: string | null,
  jobName: string
): Promise<string | null> {
  if (!templatePath) return null

  if (!isHttpUrl(templatePath)) {
    return fs.existsSync(templatePath) ? templatePath : null
  }

  const jobDir = path.join(appDesktopBaseDir(), sanitizeFileName(jobName))
  await fs.promises.mkdir(jobDir, { recursive: true })

  const localTemplatePath = path.join(jobDir, localTemplateFileName(templatePath))
  if (fs.existsSync(localTemplatePath)) return localTemplatePath

  const res = await fetchTemplateResponse(templatePath)
  if (!res.ok) {
    throw new Error(`Failed to download Excel template (HTTP ${res.status})`)
  }

  const arrayBuffer = await res.arrayBuffer()
  await fs.promises.writeFile(localTemplatePath, Buffer.from(arrayBuffer))
  return localTemplatePath
}

function emit(webContents: WebContents, progress: JobProgress): void {
  try {
    if (!webContents.isDestroyed()) {
      webContents.send('jobs:progress', progress)
    }
  } catch {
    // Window may be closed
  }
}

// ─── Throttled emit ───────────────────────────────────────────────────────────

function createThrottledEmit(
  webContents: WebContents,
  intervalMs: number = 300
): {
  emit: (progress: JobProgress) => void
  flush: (progress: JobProgress) => void
} {
  let lastEmit = 0
  let pending: JobProgress | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    emit(progress: JobProgress): void {
      const now = Date.now()
      if (now - lastEmit >= intervalMs) {
        lastEmit = now
        emit(webContents, { ...progress })
        pending = null
      } else {
        pending = { ...progress }
        if (!timer) {
          timer = setTimeout(
            () => {
              timer = null
              if (pending) {
                lastEmit = Date.now()
                emit(webContents, pending)
                pending = null
              }
            },
            intervalMs - (now - lastEmit)
          )
        }
      }
    },
    flush(progress: JobProgress): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      emit(webContents, { ...progress })
    }
  }
}

// ─── Error formatting & categorization ────────────────────────────────────────

function formatExecutionError(err: unknown, queryTimeoutSec: number): string {
  const message = err instanceof Error ? err.message : 'Query execution failed'
  const lower = message.toLowerCase()

  if (lower.includes('timeout')) {
    return `Query timed out after ${queryTimeoutSec}s. Increase Job Query Timeout in Settings or optimize the SQL query. Original error: ${message}`
  }

  return message
}

function categorizeError(err?: string | null): string {
  if (!err) return ''
  const lower = err.toLowerCase()
  if (lower.includes('invalid object name')) return 'Missing Table'
  if (lower.includes('login failed')) return 'Auth Failed'
  if (lower.includes('timeout')) return 'Timeout'
  if (lower.includes('connection')) return 'Connection Error'
  if (lower.includes('memory') || lower.includes('allocation')) return 'Memory Error'
  if (lower.includes('deadlock')) return 'Deadlock'
  if (lower.includes('permission') || lower.includes('denied')) return 'Permission Denied'
  return 'Query Error'
}

// ─── Streaming result type ────────────────────────────────────────────────────

interface StreamingConnectionResult {
  totalRows: number
  error: string | null
  chunkFiles: string[]
  /**
   * Column names captured from the SQL `recordset` event. Populated even when
   * the query returns zero rows or fails after the metadata arrives, so we can
   * still write a header-only output file for diagnostics.
   */
  columns: string[]
  /**
   * True when the connection bailed because the user cancelled the job
   * before/while connecting. Used by the runner to keep the connection in
   * 'pending' state (eligible for retry) rather than counting it as failed.
   */
  cancelled?: boolean
}

// ─── Temp file management ─────────────────────────────────────────────────────

function getTempDir(jobId: number): string {
  const tmpBase = path.join(
    process.env.TEMP || process.env.TMPDIR || '/tmp',
    'bridge-jobs',
    `job-${jobId}`
  )
  if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true })
  return tmpBase
}

async function cleanupTempDir(jobId: number): Promise<void> {
  try {
    const tmpDir = getTempDir(jobId)
    if (fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup
  }
}

async function writeChunkToFile(
  tmpDir: string,
  chunkTag: string,
  chunkIndex: number,
  rows: Record<string, unknown>[]
): Promise<string> {
  // chunkTag uses ':' which is invalid on Windows/macOS file systems; replace.
  const safeTag = chunkTag.replace(/[:/\\]/g, '_')
  const filePath = path.join(tmpDir, `${safeTag}-chunk-${chunkIndex}.ndjson`)
  // NDJSON: one JSON object per line. Allows row-by-row reads later so we
  // never materialise the entire chunk in memory just to write it back to
  // the workbook stream. Build the payload once with a single join to keep
  // the disk I/O cheap.
  const payload = rows.length === 0 ? '' : rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  await fs.promises.writeFile(filePath, payload, 'utf-8')
  return filePath
}

// ─── Chunk key (composite connection × query index) ───────────────────────────

/**
 * Chunk tags let the executor split output per (connection, queryIndex) so
 * multi-query single-connection jobs still produce one sheet per query — just
 * like multi-connection single-query jobs produce one sheet per connection.
 *
 * Tag format:
 *   - single query  → `c${connId}`
 *   - multi query   → `c${connId}-q${queryIdx}` (queryIdx is 0-based)
 */
function chunkTagFor(connId: number, queryIdx: number | null): string {
  return queryIdx === null ? `c${connId}` : `c${connId}-q${queryIdx}`
}

function parseChunkTag(tag: string): { connId: number; queryIdx: number | null } {
  const m = tag.match(/^c(\d+)(?:-q(\d+))?$/)
  if (!m) return { connId: Number.NaN, queryIdx: null }
  return {
    connId: Number(m[1]),
    queryIdx: m[2] != null ? Number(m[2]) : null
  }
}

function chunkSheetLabel(
  connection: ConnectionRow | undefined,
  queryIdx: number | null,
  queryNames: string[] = []
): string {
  const base = resolveConnectionLabel(connection)
  if (queryIdx === null) return base
  const customName = queryNames[queryIdx]?.trim()
  if (customName) return customName
  return `${base} Q${queryIdx + 1}`
}

/**
 * Resolve a connection's display label per the user's sheet-naming preference.
 * Falls back to the connection name when the chosen source is missing.
 */
function resolveConnectionLabel(connection: ConnectionRow | undefined): string {
  if (!connection) return 'Unknown'
  const source = settingsRepo.getAll().excel_sheet_name_source
  if (source !== 'connection_name' && connection.store_id != null) {
    const store = storeRepository.findById(connection.store_id)
    if (store) {
      const candidate = source === 'store_name' ? store.name : store.code
      if (candidate && candidate.trim()) return candidate.trim()
    }
  }
  return connection.name
}

async function readChunkFromFile(filePath: string): Promise<Record<string, unknown>[]> {
  const data = await fs.promises.readFile(filePath, 'utf-8')
  if (!data) return []
  // Auto-detect format: legacy JSON array vs NDJSON. Newer chunks are NDJSON.
  const head = data.charCodeAt(0)
  if (head === 0x5b /* '[' */) {
    return JSON.parse(data) as Record<string, unknown>[]
  }
  const rows: Record<string, unknown>[] = []
  let start = 0
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) !== 0x0a /* '\n' */) continue
    if (i > start) {
      const line = data.charCodeAt(i - 1) === 0x0d ? data.slice(start, i - 1) : data.slice(start, i)
      if (line.length > 0) rows.push(JSON.parse(line) as Record<string, unknown>)
    }
    start = i + 1
  }
  if (start < data.length) {
    const tail = data.slice(start).trim()
    if (tail) rows.push(JSON.parse(tail) as Record<string, unknown>)
  }
  return rows
}

/**
 * Stream rows from a chunk file one at a time. Avoids loading the full chunk
 * (up to CHUNK_SIZE rows) into memory just to copy them into the workbook.
 * Falls back to a single readFile when the chunk is in legacy JSON-array
 * format so older queued runs still work after an upgrade.
 */
async function streamChunkRows(
  filePath: string,
  onRow: (row: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
  // Peek the first byte to decide format. Legacy JSON-array files cannot be
  // streamed line-by-line; load them whole.
  let firstByte = 0
  try {
    const fh = await fs.promises.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(1)
      await fh.read(buf, 0, 1, 0)
      firstByte = buf[0]
    } finally {
      await fh.close()
    }
  } catch {
    return
  }

  if (firstByte === 0x5b /* '[' */) {
    const rows = await readChunkFromFile(filePath)
    for (const r of rows) await onRow(r)
    return
  }

  // NDJSON streaming via readline.
  const readline = await import('readline')
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line) continue
      await onRow(JSON.parse(line) as Record<string, unknown>)
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

// ─── Backpressure helper ─────────────────────────────────────────────────────

/**
 * Returns a promise that resolves once the Adaptive Brain reports that the
 * system is no longer under pressure, OR the job is cancelled, OR we've
 * waited `maxWaitMs` (safety cap). Poll interval is 200ms.
 */
async function waitForPressureClear(
  isBackpressured: () => boolean,
  isCancelled: () => boolean,
  maxWaitMs = 2_000
): Promise<void> {
  if (!isBackpressured()) return
  const deadline = Date.now() + maxWaitMs
  while (isBackpressured() && !isCancelled() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Estimate rows for one connection by wrapping each SELECT query in COUNT_BIG.
 * If wrapping fails (e.g. non-SELECT/multi-statement SQL), returns null.
 */
async function estimateRowsForSampleConnection(
  conn: ConnectionRow,
  queries: string[],
  queryTimeoutSec: number
): Promise<number | null> {
  let connected: Awaited<ReturnType<typeof connectUsingBestIp>> | null = null
  try {
    connected = await connectUsingBestIp(conn, queryTimeoutSec, queryTimeoutSec)

    let total = 0
    for (const raw of queries) {
      const trimmed = raw.trim().replace(/;+\s*$/g, '')
      if (!trimmed) continue

      // COUNT wrapper only supports a single SELECT-like statement.
      if (trimmed.includes(';')) return null

      const countSql = `SELECT COUNT_BIG(1) AS __bridge_row_count FROM (${trimmed}) AS __bridge_src`
      const result = await connected.pool.request().query(countSql)
      const row = result.recordset?.[0] as Record<string, unknown> | undefined
      const countValue = row?.__bridge_row_count
      const count = Number(countValue)
      if (!Number.isFinite(count)) return null

      total += count
    }

    return Math.max(0, Math.floor(total))
  } catch {
    return null
  } finally {
    connected?.pool.close().catch(() => {})
  }
}

// ─── Streaming query execution per connection ─────────────────────────────────

async function executeStreamingForConnection(
  conn: ConnectionRow,
  queries: string[],
  connProgress: JobConnectionProgress,
  queryTimeoutSec: number,
  jobId: number,
  chunkTag: string,
  onRowsUpdate: (rows: number) => void,
  hooks?: {
    recordRows?: (n: number) => void
    isBackpressured?: () => boolean
    isCancelled?: () => boolean
    writeRows?: (rows: Record<string, unknown>[]) => Promise<void>
    abortHandle?: JobAbortHandle
  }
): Promise<StreamingConnectionResult> {
  // Fast-path: if the user already cancelled, don't even start a connection.
  // Leave the per-connection progress in 'pending' so the jobs-list "Retry"
  // action picks it up next time.
  if (hooks?.isCancelled?.()) {
    return { totalRows: 0, error: null, chunkFiles: [], columns: [], cancelled: true }
  }

  connProgress.status = 'connecting'
  connProgress.started_at = new Date().toISOString()

  let pool: mssql.ConnectionPool | null = null
  const tmpDir = getTempDir(jobId)
  const chunkFiles: string[] = []

  try {
    // Race the connect attempt against cancellation so the worker doesn't
    // hang for ~connect-timeout seconds when the user clicks Cancel while a
    // host is unreachable.
    const connectPromise = connectUsingBestIp(conn, queryTimeoutSec, queryTimeoutSec)
    const connected = await new Promise<Awaited<typeof connectPromise>>((resolve, reject) => {
      let settled = false
      const poll = setInterval(() => {
        if (settled) return
        if (hooks?.isCancelled?.()) {
          settled = true
          clearInterval(poll)
          reject(new Error('__CANCELLED__'))
        }
      }, 50)
      connectPromise.then(
        (r) => {
          if (settled) {
            // Cancel won the race — close the late-arriving pool.
            r.pool.close().catch(() => {})
            return
          }
          settled = true
          clearInterval(poll)
          resolve(r)
        },
        (e) => {
          if (settled) return
          settled = true
          clearInterval(poll)
          reject(e)
        }
      )
    })
    pool = connected.pool
    hooks?.abortHandle?.pools.add(pool)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    if (message === '__CANCELLED__' || hooks?.isCancelled?.()) {
      // User cancelled before/while connecting — don't mark failed.
      connProgress.status = 'pending'
      connProgress.finished_at = new Date().toISOString()
      return { totalRows: 0, error: null, chunkFiles: [], columns: [], cancelled: true }
    }
    connProgress.status = 'error'
    connProgress.error = message
    connProgress.finished_at = new Date().toISOString()
    return { totalRows: 0, error: message, chunkFiles: [], columns: [] }
  }

  connProgress.status = 'querying'
  let totalRows = 0
  let currentBuffer: Record<string, unknown>[] = []
  let chunkIndex = 0
  const capturedColumns: string[] = []

  try {
    for (const query of queries) {
      if (!query.trim()) continue
      // Bail between queries if cancellation arrived while previous one ran.
      if (hooks?.isCancelled?.()) break

      // Use streaming request for large result sets
      const request = new mssql.Request(pool)
      request.stream = true
      hooks?.abortHandle?.requests.add(request)
      // In streaming mode the returned promise resolves once 'done' fires; we
      // rely on the event listeners below. Swallow here so an early rejection
      // doesn't leak as an unhandledRejection.
      request.query(query).catch(() => {})

      try {
        await new Promise<void>((resolve, reject) => {
          let cancelled = false
          let lastFlush: Promise<void> = Promise.resolve()

          // Poll for cancellation even when no rows are flowing (server still
          // planning the query). Without this the worker hangs until query
          // timeout when the user cancels mid-execution.
          const cancelPoll = setInterval(() => {
            if (cancelled) return
            if (hooks?.isCancelled?.()) {
              cancelled = true
              try {
                request.cancel()
              } catch {
                // ignore
              }
              clearInterval(cancelPoll)
              resolve()
            }
          }, 50)

          // Capture column metadata as soon as it arrives so we can still write a
          // header-only error file when the query subsequently fails or yields
          // zero rows.
          request.on('recordset', (cols: Record<string, unknown> | undefined) => {
            if (capturedColumns.length === 0 && cols && typeof cols === 'object') {
              for (const key of Object.keys(cols)) capturedColumns.push(key)
            }
          })

          request.on('row', (row: Record<string, unknown>) => {
            if (cancelled) return
            // Honor user cancellation mid-stream — abort the mssql request so
            // we don't keep fetching rows that will be discarded.
            if (hooks?.isCancelled?.()) {
              cancelled = true
              try {
                request.cancel()
              } catch {
                // ignore
              }
              return
            }
            totalRows++
            currentBuffer.push(row)

            // Flush buffer when chunk size reached
            if (currentBuffer.length >= CHUNK_SIZE) {
              const rowsToFlush = currentBuffer
              currentBuffer = []

              request.pause()
              lastFlush = lastFlush
                .then(async () => {
                  // Backpressure gate — pause before each flush if the brain
                  // reports the host is saturated.
                  if (hooks?.isBackpressured) {
                    await waitForPressureClear(
                      hooks.isBackpressured,
                      hooks.isCancelled ?? (() => false)
                    )
                  }

                  if (hooks?.writeRows) {
                    await hooks.writeRows(rowsToFlush)
                  } else {
                    const fp = await writeChunkToFile(tmpDir, chunkTag, chunkIndex++, rowsToFlush)
                    chunkFiles.push(fp)
                  }

                  hooks?.recordRows?.(rowsToFlush.length)
                  onRowsUpdate(totalRows)
                })
                .finally(() => {
                  if (!cancelled) request.resume()
                })
            }

            // Safety valve
            if (totalRows >= MAX_ROWS_PER_CONNECTION) {
              cancelled = true
              request.cancel()
            }
          })

          request.on('error', (err: Error) => {
            clearInterval(cancelPoll)
            if (cancelled) {
              resolve()
              return
            }
            reject(err)
          })

          request.on('done', () => {
            clearInterval(cancelPoll)
            lastFlush.then(() => resolve()).catch(reject)
          })
        })
      } finally {
        hooks?.abortHandle?.requests.delete(request)
      }
    }

    // Flush remaining buffer
    if (currentBuffer.length > 0) {
      if (hooks?.writeRows) {
        await hooks.writeRows(currentBuffer)
      } else {
        const fp = await writeChunkToFile(tmpDir, chunkTag, chunkIndex++, currentBuffer)
        chunkFiles.push(fp)
      }
      hooks?.recordRows?.(currentBuffer.length)
      currentBuffer = []
    }

    connProgress.status = 'done'
    connProgress.rows = totalRows
    connProgress.finished_at = new Date().toISOString()
    onRowsUpdate(totalRows)
    return { totalRows, error: null, chunkFiles, columns: capturedColumns }
  } catch (err) {
    // Flush whatever we have
    if (currentBuffer.length > 0) {
      try {
        if (hooks?.writeRows) {
          await hooks.writeRows(currentBuffer)
        } else {
          const fp = await writeChunkToFile(tmpDir, chunkTag, chunkIndex++, currentBuffer)
          chunkFiles.push(fp)
        }
      } catch {
        // If flush fails during error path, keep original query error for better diagnosis.
      }
      currentBuffer = []
    }

    const error = formatExecutionError(err, queryTimeoutSec)
    connProgress.status = 'error'
    connProgress.error = error
    connProgress.rows = totalRows
    connProgress.finished_at = new Date().toISOString()
    return { totalRows, error, chunkFiles, columns: capturedColumns }
  } finally {
    if (pool) {
      hooks?.abortHandle?.pools.delete(pool)
      pool.close().catch(() => {})
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a single cell value coming from an SQL query result row.
 * - Date objects            → "dd/mm/yyyy"
 * - Date-only strings       → "dd/mm/yyyy"  (e.g. "2024-03-15", "2024-03-15T00:00:00.000Z")
 * - DateTime strings        → "dd/mm/yyyy HH:MM:SS"
 * - Everything else         → returned as-is (numbers, booleans, null, etc.)
 *
 * Applied to ALL query data sheets. The Summary sheet is NOT affected —
 * it uses its own `formatUtcToIst` formatter.
 */
function formatQueryValue(v: unknown): unknown {
  if (v === null || v === undefined) return v

  let d: Date | null = null

  if (v instanceof Date) {
    d = v
  } else if (typeof v === 'string') {
    // Only attempt to parse strings that look like dates.
    // Patterns: "2024-03-15", "2024-03-15T10:30:00", "2024-03-15T10:30:00.000Z",
    //           "2024-03-15 10:30:00", "2024/03/15", etc.
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(v)) {
      const parsed = new Date(v)
      if (!Number.isNaN(parsed.getTime())) d = parsed
    }
  }

  if (!d) return v // not a date — pass through unchanged

  const pad = (n: number): string => String(n).padStart(2, '0')
  const dd = pad(d.getDate())
  const mm = pad(d.getMonth() + 1)
  const yyyy = d.getFullYear()

  // Data sheets: always dd/mm/yyyy — no time component.
  return `${dd}/${mm}/${yyyy}`
}

/**
 * Apply `formatQueryValue` to every value in a row object, returning a
 * new object with dates converted to dd/mm/yyyy strings.
 * When `modifyDates` is false the row is returned as-is.
 */
function formatQueryRow(row: Record<string, unknown>, modifyDates = true): Record<string, unknown> {
  if (!modifyDates) return row
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    out[key] = formatQueryValue(row[key])
  }
  return out
}

/**
 * Replace `{{varName}}` placeholders in a SQL query string with the
 * per-connection values. Falls back to `defaultValue` when the connection
 * has no stored checkpoint yet. Warns and leaves the placeholder when
 * neither a stored value nor a default is available (so the query still
 * runs and the user sees an obvious SQL error rather than a silent wrong result).
 */
function injectVariables(
  sql: string,
  connVars: Record<string, string>,
  varMeta: Map<
    string,
    {
      id: number
      defaultValue: string | null
      autoUpdate: boolean
      sourceColumn: string | null
      updateFn: 'max' | 'min' | 'last'
    }
  >
): string {
  return sql.replace(/\{\{([^}]+)\}\}/g, (_match, name: string) => {
    const trimmed = name.trim()
    // Stored per-connection value takes priority
    if (trimmed in connVars) return connVars[trimmed]
    // Fall back to the variable's default_value
    const meta = varMeta.get(trimmed)
    if (meta?.defaultValue != null) return meta.defaultValue
    // Nothing found — throw a clear error instead of leaving {{var}} in SQL
    // (SQL Server would reject the { character with a confusing syntax error)
    throw new Error(
      `SQL variable {{${trimmed}}} has no configured value and no default. ` +
        `Please set a value in Jobs → Variables for this connection, or add a default value.`
    )
  })
}

function sanitizeSheetName(name: string): string {
  const forbidden = ['\\', '/', '*', '?', ':', '[', ']']
  let out = name
  for (const ch of forbidden) {
    out = out.split(ch).join('_')
  }
  return out.slice(0, 31)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

function fileTimestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function isDirectoryPath(p: string): boolean {
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return true
  } catch {
    // fall through
  }
  return path.extname(p) === ''
}

// ─── Excel styling ────────────────────────────────────────────────────────────

function applyHeaderStyle(
  sheet: ExcelJS.Worksheet,
  rowNumber: number = 1,
  headerColor: string = 'FF0284C7'
): void {
  const headerRow = sheet.getRow(rowNumber)
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: headerColor }
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBBD8E8' } },
      left: { style: 'thin', color: { argb: 'FFBBD8E8' } },
      bottom: { style: 'thin', color: { argb: 'FFBBD8E8' } },
      right: { style: 'thin', color: { argb: 'FFBBD8E8' } }
    }
  })
}

function applyStatusStyle(cell: ExcelJS.Cell, rawStatus: string | null | undefined): void {
  const status = (rawStatus ?? '').toLowerCase()
  if (['success', 'done', 'ok'].includes(status)) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }
    cell.font = { bold: true, color: { argb: 'FF166534' } }
    return
  }
  if (['failed', 'error', 'cancelled'].includes(status)) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    cell.font = { bold: true, color: { argb: 'FF991B1B' } }
    return
  }
  if (['partial', 'running', 'querying', 'connecting'].includes(status)) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
    cell.font = { bold: true, color: { argb: 'FF92400E' } }
    return
  }
  if (status === 'pending') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
    cell.font = { bold: true, color: { argb: 'FF334155' } }
  }
}

// Data-sheet styling has been removed — styling per row across millions of
// rows blew up memory and slowed the writer down. Only the Summary sheet is
// styled now.

// ─── Streaming Excel writer ───────────────────────────────────────────────────

/**
 * Threshold after which a fresh continuation sheet is created for the same
 * logical output bucket (per connection, or per query in multi-query mode).
 *
 * Default 800_000 ≈ 80% of Excel's hard row cap (1,048,576). User-configurable
 * via Settings → "Excel sheet row threshold".
 */
function resolveSheetRowThreshold(): number {
  const raw = settingsRepo.getAll().excel_sheet_row_threshold
  const EXCEL_ROW_HARD_CAP = 1_048_576
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 800_000
  return Math.min(Math.floor(n), EXCEL_ROW_HARD_CAP)
}

/**
 * Build the list of output buckets that should be written to the workbook,
 * one entry per (connection, optional query index). Each bucket becomes one
 * or more sheets (with `_part1`, `_part2` … rollovers when the row threshold
 * is hit and the bucket is large enough to need splitting).
 */
interface OutputBucket {
  tag: string
  connection: ConnectionRow | undefined
  queryIdx: number | null
  chunkFiles: string[]
  label: string
  /** Captured query column names (may be empty if the query failed before metadata arrived). */
  columns: string[]
  /** Per-bucket error message — used to emit an "error" sheet/file when no rows were written. */
  error: string | null
  /** Total rows captured for this bucket — used to pre-decide split naming. */
  rows: number
}

/**
 * Per-bucket metadata threaded out of the streaming executor so the output
 * writers can emit a header + error row when a query fails or returns no
 * rows. Keyed by the same tag used for `allChunkFiles`.
 */
interface BucketMeta {
  columns: string[]
  error: string | null
  rows: number
}

function listOutputBuckets(
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map()
): OutputBucket[] {
  const connById = new Map(connections.map((c) => [c.id, c]))
  const buckets: OutputBucket[] = []
  const seenTags = new Set<string>()
  for (const [tag, chunkFiles] of allChunkFiles) {
    if (!chunkFiles || chunkFiles.length === 0) continue
    seenTags.add(tag)
    const { connId, queryIdx } = parseChunkTag(tag)
    const connection = connById.get(connId)
    const meta = allBucketMeta.get(tag)
    buckets.push({
      tag,
      connection,
      queryIdx,
      chunkFiles,
      label: chunkSheetLabel(connection, queryIdx, queryNames),
      columns: meta?.columns ?? [],
      error: meta?.error ?? null,
      rows: meta?.rows ?? 0
    })
  }

  // Always emit a bucket for any tag that has metadata with an error (so we
  // can write a header + error row file) even when no rows were captured.
  for (const [tag, meta] of allBucketMeta) {
    if (seenTags.has(tag)) continue
    if (!meta.error) continue
    seenTags.add(tag)
    const { connId, queryIdx } = parseChunkTag(tag)
    const connection = connById.get(connId)
    buckets.push({
      tag,
      connection,
      queryIdx,
      chunkFiles: [],
      label: chunkSheetLabel(connection, queryIdx, queryNames),
      columns: meta.columns,
      error: meta.error,
      rows: meta.rows
    })
  }

  // When the user has opted in to "create empty sheets", include one bucket
  // per connection that produced no rows so the workbook maintains a
  // consistent structure across the entire connection set.
  if (settingsRepo.getAll().excel_create_empty_sheets) {
    // Determine whether this is a multi-query run by checking if any bucket
    // has a non-null queryIdx or if queryNames has entries.
    const isMultiQ =
      queryNames.length > 0 ||
      Array.from(allChunkFiles.keys()).some((k) => parseChunkTag(k).queryIdx !== null)

    for (const conn of connections) {
      if (isMultiQ) {
        // Multi-query: emit one empty bucket per query index that is missing.
        const queryCount = Math.max(1, queryNames.length)
        for (let qi = 0; qi < queryCount; qi++) {
          const qTag = chunkTagFor(conn.id, qi)
          if (!seenTags.has(qTag)) {
            seenTags.add(qTag)
            const meta = allBucketMeta.get(qTag)
            buckets.push({
              tag: qTag,
              connection: conn,
              queryIdx: qi,
              chunkFiles: [],
              label: chunkSheetLabel(conn, qi, queryNames),
              columns: meta?.columns ?? [],
              error: meta?.error ?? null,
              rows: meta?.rows ?? 0
            })
          }
        }
      } else {
        // Single-query: emit one empty bucket per connection with no rows.
        const emptyTag = chunkTagFor(conn.id, null)
        const alreadyHasAny = Array.from(allChunkFiles.keys()).some((k) => {
          const p = parseChunkTag(k)
          return p.connId === conn.id
        })
        if (!alreadyHasAny && !seenTags.has(emptyTag)) {
          buckets.push({
            tag: emptyTag,
            connection: conn,
            queryIdx: null,
            chunkFiles: [],
            label: chunkSheetLabel(conn, null),
            columns: [],
            error: null,
            rows: 0
          })
        }
      }
    }
  }

  // Stable sort: by resolved label, then by queryIdx (nulls first).
  buckets.sort((a, b) => {
    const cmp = a.label.localeCompare(b.label)
    if (cmp !== 0) return cmp
    return (a.queryIdx ?? -1) - (b.queryIdx ?? -1)
  })
  return buckets
}

function nextRolloverSheetName(
  base: string,
  index: number,
  taken: Set<string>,
  splitNaming: boolean = false
): string {
  const safe = sanitizeSheetName(base)
  // When the bucket is known to overflow the sheet-row threshold we name
  // every sheet `{base}_part{n}` (starting at part1) so users can tell at a
  // glance that the dataset was split. For buckets that fit in one sheet we
  // keep the bare base name to avoid noisy `_part1` suffixes everywhere.
  if (!splitNaming && index === 0) {
    const key = safe.toLowerCase()
    if (!taken.has(key)) {
      taken.add(key)
      return safe
    }
  }
  // Reserve room for the suffix (`_partNN` ≈ 7 chars) inside Excel's 31-char
  // sheet-name limit so the part suffix is never truncated.
  const stem = safe.slice(0, 24)
  let i = splitNaming ? Math.max(1, index + 1) : Math.max(2, index + 1)
  for (;;) {
    const candidate = `${stem}_part${i}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
    i++
    if (i > 9999) {
      const fb = `${stem}_part${Date.now() % 10_000}`
      taken.add(fb.toLowerCase())
      return fb
    }
  }
}

/**
 * Build the lowercase set of worksheet names that the writer will produce
 * for `buckets` (including `_partN` rollovers). Used to decide which existing
 * sheets in the destination workbook should be preserved when replacing.
 */
function bucketSheetNamePatterns(buckets: OutputBucket[]): {
  exactNames: Set<string>
  basePrefixes: string[]
} {
  const exactNames = new Set<string>()
  const basePrefixes: string[] = []
  for (const b of buckets) {
    const base = sanitizeSheetName(b.label).toLowerCase()
    exactNames.add(base)
    // _part rollovers may also occur — match by 24-char stem prefix used by
    // nextRolloverSheetName() to keep within Excel's 31-char limit.
    const stem = sanitizeSheetName(b.label).slice(0, 24).toLowerCase()
    basePrefixes.push(stem)
  }
  return { exactNames, basePrefixes }
}

/**
 * Return true if `sheetName` corresponds to one of the bucket sheets the
 * writer will (re)create — these are the only sheets we OVERWRITE on a
 * replace run. Anything else (e.g. a manually added "Report" sheet) is
 * preserved verbatim.
 */
function isBucketSheetName(
  sheetName: string,
  patterns: { exactNames: Set<string>; basePrefixes: string[] }
): boolean {
  const lc = sheetName.toLowerCase()
  if (lc === 'summary') return true
  if (patterns.exactNames.has(lc)) return true
  for (const stem of patterns.basePrefixes) {
    if (stem && lc.startsWith(stem) && /_part\d+$/.test(lc)) return true
  }
  return false
}

/**
 * Snapshot of a worksheet's cells for re-emission via the streaming writer.
 * Captured up-front from the existing destination so user-added sheets
 * (e.g. a manually maintained "Report" tab) survive a replace-mode run.
 */
interface PreservedSheet {
  name: string
  rows: ExcelJS.CellValue[][]
  columnWidths: Array<number | undefined>
}

/**
 * Preserving user-added sheets (formulas, styling, charts, merged cells,
 * named ranges, …) requires loading the existing workbook with ExcelJS,
 * which holds it entirely in the V8 heap. We deliberately do NOT cap the
 * file size here — the user's explicit requirement is "preserve other
 * sheets no matter what the file size". If `readFile` runs out of memory
 * or fails to parse, `writeInPlaceExcelReplace` returns `null` and the
 * caller falls back to the streaming writer (which produces a clean
 * workbook so the run never fails outright).
 *
 * To handle very large workbooks reliably, the Electron main process is
 * launched with `--max-old-space-size` raised in the app entry point.
 */

/**
 * Replace-mode writer that opens the existing destination workbook
 * IN-MEMORY, removes only the sheets this job owns (bucket sheets + the
 * old "Summary"), then writes the new bucket sheets and a fresh Summary
 * back into the SAME workbook before saving.
 *
 * This is the path users want for files that already contain manually
 * curated sheets — e.g. a "Report" tab with formulas, conditional
 * formatting, charts, named ranges, merged cells, pivot caches, etc.
 * Because we modify the existing workbook object rather than rebuilding
 * it from cell values, every untouched sheet is preserved BIT-EXACT.
 *
 * When the destination file already exists, it is loaded and only the
 * sheets owned by this job (per-connection bucket sheets + the previous
 * "Summary") are removed/recreated. When it does NOT exist, a fresh
 * workbook is created, the bucket sheets + Summary are added to it, and
 * it is saved at `filePath` — no preservation work is needed in that
 * case because there are no other sheets to keep.
 *
 * Returns the destination path on success, or `null` if an EXISTING
 * workbook couldn't be opened (corrupt / locked / OOM). The caller falls
 * back to the streaming writer in that case so the run still produces
 * output. A non-existent destination never triggers the fallback.
 */
async function writeInPlaceExcelReplace(
  filePath: string,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map(),
  modifyDates = true,
  summaryExtraColumns: string[] = []
): Promise<string | null> {
  const workbook = new ExcelJS.Workbook()
  const fileExists = fs.existsSync(filePath)
  if (fileExists) {
    // Refuse to load very large files into the V8 heap — loading a 200 MB+
    // workbook can exhaust the process memory and crash with OOM. The caller
    // falls back to writeStreamingExcelReplace which writes incrementally.
    try {
      const { size } = fs.statSync(filePath)
      if (size > MAX_IN_PLACE_WORKBOOK_BYTES) return null
    } catch {
      return null
    }
    try {
      await workbook.xlsx.readFile(filePath)
    } catch {
      // Couldn't open existing file — let the caller fall back.
      return null
    }
  }
  // When the file doesn't exist we just keep the fresh empty `workbook`
  // and fall straight through to the bucket-sheet writer below, which
  // adds the new sheets and saves to `filePath`.

  const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
  const patterns = bucketSheetNamePatterns(buckets)

  // Remove ONLY the sheets this job owns: previous bucket sheets (incl.
  // their `_partN` rollovers from a prior run) and the old "Summary".
  // EVERY OTHER SHEET — user-added Reports, formula tabs, charts, pivots,
  // etc. — is left untouched so it round-trips through the save unchanged.
  const sheetsToRemove: number[] = []
  workbook.eachSheet((ws) => {
    if (isBucketSheetName(ws.name, patterns)) sheetsToRemove.push(ws.id)
  })
  for (const id of sheetsToRemove) {
    const ws = workbook.getWorksheet(id)
    if (ws) workbook.removeWorksheet(ws.id)
  }

  const threshold = resolveSheetRowThreshold()
  const taken = new Set<string>()
  for (const ws of workbook.worksheets) taken.add(ws.name.toLowerCase())
  taken.add('summary')

  for (const bucket of buckets) {
    const baseSheetName = sanitizeSheetName(bucket.label)
    const willSplit = bucket.rows > threshold
    const name = nextRolloverSheetName(baseSheetName, 0, taken, willSplit)
    let sheet = workbook.addWorksheet(name)
    let rolloverIndex = 0

    let headers: string[] = []
    let headersSet = false
    let rowsInSheet = 0

    // Empty bucket — emit header (and an error row when applicable) so
    // users still get a per-bucket diagnostic artefact.
    if (bucket.chunkFiles.length === 0) {
      if (bucket.columns.length > 0) {
        headers = bucket.error ? [...bucket.columns, 'Error'] : [...bucket.columns]
        sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
      } else if (bucket.error) {
        headers = ['Error']
        sheet.columns = [{ header: 'Error', key: 'Error', width: 60 }]
      } else {
        headers = ['No rows found']
        sheet.columns = [{ header: 'No rows found', key: 'msg', width: 30 }]
      }
      if (bucket.error) {
        const cells: Record<string, unknown> = {}
        if (bucket.columns.length > 0) {
          for (const c of bucket.columns) cells[c] = ''
          cells['Error'] = bucket.error
        } else {
          cells['Error'] = bucket.error
        }
        sheet.addRow(cells)
      } else if (!bucket.columns.length) {
        sheet.addRow({ msg: 'No rows found' })
      }
      continue
    }

    for (const chunkFile of bucket.chunkFiles) {
      await streamChunkRows(chunkFile, (row) => {
        const fmtRow = formatQueryRow(row, modifyDates)
        if (!headersSet) {
          headers = Object.keys(fmtRow)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          headersSet = true
          rowsInSheet = 1
        }
        if (rowsInSheet >= threshold) {
          rolloverIndex++
          const nextName = nextRolloverSheetName(baseSheetName, rolloverIndex, taken, willSplit)
          sheet = workbook.addWorksheet(nextName)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          rowsInSheet = 1
        }
        sheet.addRow(fmtRow)
        rowsInSheet++
      })
    }
  }

  writeSummarySheet(
    workbook,
    jobName,
    progress,
    connections,
    queryNames,
    allBucketMeta,
    summaryExtraColumns
  )

  let fileDir = path.dirname(filePath)
  try {
    if (!fs.existsSync(fileDir)) await fs.promises.mkdir(fileDir, { recursive: true })
  } catch {
    fileDir = appDesktopBaseDir()
    await fs.promises.mkdir(fileDir, { recursive: true })
    filePath = path.join(fileDir, path.basename(filePath))
  }

  await workbook.xlsx.writeFile(filePath)
  return filePath
}

async function writeStreamingExcelCombined(
  destPath: string,
  operation: 'append' | 'replace' | null,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  summaryExtraColumns: string[] = [],
  modifyDates = true,
  template?: {
    templatePath: string | null
    templateMode: 'new' | 'existing' | null
  }
): Promise<string> {
  const templatePath = template?.templatePath ?? null
  const templateMode = template?.templateMode ?? null
  const templateExists = Boolean(templatePath) && fs.existsSync(templatePath!)
  const hasTemplate = templateExists && Boolean(templateMode)

  let filePath: string
  if (hasTemplate && templateMode === 'existing') {
    // Write data INTO the template file itself — same as non-combine mode.
    filePath = templatePath!
  } else if (isDirectoryPath(destPath)) {
    // When template is configured but not locally available, use a stable
    // filename (no timestamp) so every run updates the same output file.
    const fileName =
      templateMode === 'existing'
        ? `${sanitizeFileName(jobName)}.xlsx`
        : `${sanitizeFileName(jobName)}_${fileTimestamp()}.xlsx`
    const baseDir = fs.existsSync(destPath) ? destPath : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    filePath = path.join(baseDir, fileName)
  } else {
    const parsed = path.parse(destPath)
    const baseDir = fs.existsSync(parsed.dir) ? parsed.dir : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    filePath = path.join(baseDir, parsed.base)
  }

  // ── Load existing workbook (replace mode) ────────────────────────────────
  // When replace is requested and the file already exists, load it so that
  // any user-added sheets (reports, formula tabs, charts …) are preserved.
  // Only the "Data" sheet, individual bucket sheets and the Summary are
  // removed and rewritten. If the file is too large or corrupt we fall back
  // to a fresh workbook.
  const workbook = new ExcelJS.Workbook()
  const fileExists = fs.existsSync(filePath)
  const buckets = listOutputBuckets(connections, allChunkFiles, [], new Map())
  const bucketPatterns = bucketSheetNamePatterns(buckets)

  if (operation === 'replace' && fileExists) {
    try {
      const { size } = fs.statSync(filePath)
      if (size <= MAX_IN_PLACE_WORKBOOK_BYTES) {
        await workbook.xlsx.readFile(filePath)
      }
    } catch {
      // Couldn't read — proceed with empty workbook
    }
    // Remove old "Data" sheet, individual bucket sheets, and Summary
    const toRemove: number[] = []
    workbook.eachSheet((ws) => {
      if (
        ws.name === 'Data' ||
        ws.name.toLowerCase() === 'summary' ||
        isBucketSheetName(ws.name, bucketPatterns)
      ) {
        toRemove.push(ws.id)
      }
    })
    for (const id of toRemove) {
      const ws = workbook.getWorksheet(id)
      if (ws) workbook.removeWorksheet(ws.id)
    }
  }

  // ── Combined "Data" sheet (all connections, Sheet Name as first column) ──
  const dataSheet = workbook.addWorksheet('Data')
  let globalHeadersSet = false

  for (const conn of connections) {
    const chunkTag = chunkTagFor(conn.id, null)
    const chunkFiles = allChunkFiles.get(chunkTag) ?? []
    if (chunkFiles.length === 0) continue

    const sheetName = resolveConnectionLabel(conn)

    for (const chunkFile of chunkFiles) {
      await streamChunkRows(chunkFile, (row) => {
        const fmtRow = formatQueryRow(row, modifyDates)
        const rowKeys = Object.keys(fmtRow)
        const values = Object.values(fmtRow) as unknown[]

        // Write ONE styled header row at the very top — first column is "Sheet Name"
        if (!globalHeadersSet) {
          const allHeaders = ['Sheet Name', ...rowKeys]
          dataSheet.columns = allHeaders.map((h, i) => ({
            width:
              i === 0
                ? Math.max(20, sheetName.length + 4)
                : Math.max(18, Math.min(40, h.length + 4))
          }))
          const headerRow = dataSheet.addRow(allHeaders)
          headerRow.height = 22
          const headerColor = 'FF0284C7'
          headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
            if (colNum > allHeaders.length) return
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFBBD8E8' } },
              left: { style: 'thin', color: { argb: 'FFBBD8E8' } },
              bottom: { style: 'thin', color: { argb: 'FFBBD8E8' } },
              right: { style: 'thin', color: { argb: 'FFBBD8E8' } }
            }
          })
          globalHeadersSet = true
        }

        // Sheet Name is the first value in every data row
        dataSheet.addRow([sheetName, ...values])
      })
    }
  }

  // ── Individual per-connection sheets (same as normal Excel mode) ─────────
  const threshold = resolveSheetRowThreshold()
  const taken = new Set<string>(['data', 'summary'])
  for (const ws of workbook.worksheets) taken.add(ws.name.toLowerCase())

  for (const bucket of buckets) {
    const baseSheetName = sanitizeSheetName(bucket.label)
    const willSplit = bucket.rows > threshold
    const name = nextRolloverSheetName(baseSheetName, 0, taken, willSplit)
    let sheet = workbook.addWorksheet(name)
    taken.add(name.toLowerCase())
    let rolloverIndex = 0
    let headers: string[] = []
    let headersSet = false
    let rowsInSheet = 0

    if (bucket.chunkFiles.length === 0) {
      if (bucket.columns.length > 0) {
        headers = bucket.error ? [...bucket.columns, 'Error'] : [...bucket.columns]
        sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
      } else {
        sheet.columns = [{ header: 'No rows found', key: 'msg', width: 30 }]
      }
      if (bucket.error) {
        const cells: Record<string, unknown> = {}
        for (const c of bucket.columns) cells[c] = ''
        cells['Error'] = bucket.error
        sheet.addRow(cells)
      } else if (!bucket.columns.length) {
        sheet.addRow({ msg: 'No rows found' })
      }
      continue
    }

    for (const chunkFile of bucket.chunkFiles) {
      await streamChunkRows(chunkFile, (row) => {
        const fmtRow = formatQueryRow(row, modifyDates)
        if (!headersSet) {
          headers = Object.keys(fmtRow)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          headersSet = true
          rowsInSheet = 1
        }
        if (rowsInSheet >= threshold) {
          rolloverIndex++
          const nextName = nextRolloverSheetName(baseSheetName, rolloverIndex, taken, willSplit)
          sheet = workbook.addWorksheet(nextName)
          taken.add(nextName.toLowerCase())
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          rowsInSheet = 1
        }
        sheet.addRow(fmtRow)
        rowsInSheet++
      })
    }
  }

  writeSummarySheet(workbook, jobName, progress, connections, [], new Map(), summaryExtraColumns)

  let fileDir = path.dirname(filePath)
  try {
    if (!fs.existsSync(fileDir)) await fs.promises.mkdir(fileDir, { recursive: true })
  } catch {
    fileDir = appDesktopBaseDir()
    await fs.promises.mkdir(fileDir, { recursive: true })
    filePath = path.join(fileDir, path.basename(filePath))
  }

  await workbook.xlsx.writeFile(filePath)
  return filePath
}

async function writeStreamingExcel(
  destPath: string,
  operation: 'append' | 'replace' | null,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  template?: {
    templatePath: string | null
    templateMode: 'new' | 'existing' | null
  },
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map(),
  modifyDates = true,
  summaryExtraColumns: string[] = []
): Promise<string> {
  let filePath: string
  let effectiveOp = operation

  const templatePath = template?.templatePath ?? null
  const templateMode = template?.templateMode ?? null
  // Treat template as absent if the file doesn't actually exist on this machine.
  const templateExists = Boolean(templatePath) && fs.existsSync(templatePath!)
  const hasTemplate = templateExists && Boolean(templateMode)

  if (hasTemplate && templateMode === 'existing') {
    // EXISTING template: we write sheets INTO the template file in-place.
    filePath = templatePath!
    effectiveOp = operation ?? 'replace'
  } else if (isDirectoryPath(destPath)) {
    // Try the configured directory first; fall back to Desktop/<AppName>/ if inaccessible.
    const baseDir = fs.existsSync(destPath) ? destPath : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    // When a template is configured in "existing" mode but isn't available on this
    // device (templatePath resolved to null), use a STABLE filename with no timestamp
    // so every run finds and updates the same output file rather than creating a new
    // timestamped artefact. When no template is configured, keep the timestamped
    // name so multiple independent runs don't overwrite each other.
    const fileName =
      templateMode === 'existing'
        ? `${sanitizeFileName(jobName)}.xlsx`
        : `${sanitizeFileName(jobName)}_${fileTimestamp()}.xlsx`
    filePath = path.join(baseDir, fileName)
    effectiveOp = 'replace'
  } else {
    // destPath is a file path — use its directory, falling back to Desktop/<AppName>/ if needed.
    const parsed = path.parse(destPath)
    const baseDir = fs.existsSync(parsed.dir) ? parsed.dir : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    filePath = path.join(baseDir, parsed.base)
  }

  // ── Replace short-circuit ────────────────────────────────────────────────
  // `replace` means "overwrite the destination workbook with this run's
  // output". The legacy in-memory path below would `workbook.xlsx.readFile`
  // an existing destination first, which OOMs on large (80 MB+) workbooks.
  // For replace we always go through the streaming writer regardless of
  // whether the destination file already exists or whether a template was
  // provided — the template's previous contents are intentionally discarded.
  if (effectiveOp === 'replace') {
    // Replace mode: keep ALL user-added sheets (Reports, formula tabs,
    // charts, pivots, named ranges …) intact. We only rewrite the sheets
    // this job owns — the per-connection bucket sheets and the Summary.
    //
    // Strategy (single, uniform path):
    //   • The in-place helper handles BOTH cases:
    //       1. File exists → load it with ExcelJS, remove only bucket +
    //          Summary sheets, write the new bucket + Summary sheets back
    //          into the SAME workbook, save. Every other sheet round-trips
    //          bit-exact (formulas, conditional formatting, merged cells,
    //          charts, named ranges, …).
    //       2. File does NOT exist → start with a fresh workbook, add the
    //          bucket sheets + Summary, save at `filePath`. There are no
    //          user sheets to preserve in this case, so nothing is lost.
    //   • Only when an EXISTING workbook can't be opened (corrupt / locked
    //     / OOM) does the helper return `null` and we fall back to the
    //     streaming writer, guaranteeing the run still produces output.
    const written = await writeInPlaceExcelReplace(
      filePath,
      jobName,
      progress,
      connections,
      allChunkFiles,
      queryNames,
      allBucketMeta,
      modifyDates,
      summaryExtraColumns
    )
    if (written) return written

    // In-place load failed for an existing file. Surface a warning so
    // the user knows manually-added sheets in that file weren't carried
    // over by this fallback path, then write a fresh workbook via the
    // streaming writer.
    progress.error =
      progress.error ??
      'Could not open destination workbook to preserve user-added sheets — wrote a fresh workbook'
    try {
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
    } catch {
      // Best-effort: if we can't delete (e.g. file locked), the writer
      // below will overwrite via its create-truncate semantics anyway.
    }
    return await writeStreamingExcelReplace(
      filePath,
      jobName,
      progress,
      connections,
      allChunkFiles,
      queryNames,
      allBucketMeta,
      undefined,
      modifyDates,
      summaryExtraColumns
    )
  }

  if (hasTemplate && templateMode === 'new') {
    // NEW template: copy template to the output path, then append data sheets.
    let tplDir = path.dirname(filePath)
    try {
      await fs.promises.mkdir(tplDir, { recursive: true })
    } catch {
      tplDir = appDesktopBaseDir()
      await fs.promises.mkdir(tplDir, { recursive: true })
      filePath = path.join(tplDir, path.basename(filePath))
    }
    await fs.promises.copyFile(templatePath!, filePath)
    // Treat as append on the copy so template sheets are preserved.
    effectiveOp = 'append'
  }

  if (!hasTemplate && effectiveOp === 'append' && progress.total_rows > APPEND_SAFE_ROW_LIMIT) {
    const parsed = path.parse(filePath)
    const safeName = `${parsed.name}_large_${fileTimestamp()}.xlsx`
    filePath = path.join(parsed.dir, safeName)
    effectiveOp = 'replace'
  }

  if (effectiveOp === 'replace') {
    // Append-mode-too-large fallback above flipped us to replace. Same
    // streaming path as the early-out — never load an existing workbook.
    if (fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath)
      } catch {
        // best-effort
      }
    }
    return await writeStreamingExcelReplace(
      filePath,
      jobName,
      progress,
      connections,
      allChunkFiles,
      queryNames,
      allBucketMeta,
      undefined,
      modifyDates,
      summaryExtraColumns
    )
  }

  const workbook = new ExcelJS.Workbook()

  if ((effectiveOp === 'append' || hasTemplate) && fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath)
  }

  const threshold = resolveSheetRowThreshold()
  // Data sheets are never styled — only the Summary sheet gets formatting.
  // This keeps memory + write-time flat across millions of rows and avoids
  // clobbering any styling a user-provided template may already own.
  const taken = new Set<string>()
  for (const ws of workbook.worksheets) taken.add(ws.name.toLowerCase())
  taken.add('summary')

  const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
  for (const bucket of buckets) {
    // Cancel does NOT abort the writer mid-flight (see writeStreamingExcelReplace).
    const baseSheetName = sanitizeSheetName(bucket.label)
    const willSplit = bucket.rows > threshold
    const existing = workbook.getWorksheet(baseSheetName)

    // Acquire initial sheet (append to existing when op=append, else replace).
    let sheet: ExcelJS.Worksheet
    let rolloverIndex = 0
    if (effectiveOp === 'append' && existing) {
      sheet = existing
      taken.add(existing.name.toLowerCase())
    } else {
      if (existing) {
        taken.delete(existing.name.toLowerCase())
        workbook.removeWorksheet(existing.id)
      }
      const name = nextRolloverSheetName(baseSheetName, 0, taken, willSplit)
      sheet = workbook.addWorksheet(name)
    }

    let rowsInSheet = sheet.rowCount
    let headersSet = rowsInSheet > 0
    let headers: string[] = []
    if (headersSet) {
      const first = sheet.getRow(1)
      first.eachCell({ includeEmpty: true }, (cell) => {
        headers.push(cell.value != null ? String(cell.value) : '')
      })
    }

    // No rows but error/empty — still emit a header (and an error row when
    // applicable) so users have a diagnostic artefact per bucket.
    if (bucket.chunkFiles.length === 0) {
      if (!headersSet && bucket.columns.length > 0) {
        headers = bucket.error ? [...bucket.columns, 'Error'] : [...bucket.columns]
        sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
        headersSet = true
      } else if (!headersSet && bucket.error) {
        headers = ['Error']
        sheet.columns = headers.map((col) => ({ header: col, key: col, width: 60 }))
        headersSet = true
      } else if (!headersSet) {
        headers = ['No rows found']
        sheet.columns = [{ header: 'No rows found', key: 'msg', width: 30 }]
        headersSet = true
      }
      if (bucket.error) {
        const cells: Record<string, unknown> = {}
        if (bucket.columns.length > 0) {
          for (const c of bucket.columns) cells[c] = ''
          cells['Error'] = bucket.error
        } else {
          cells['Error'] = bucket.error
        }
        sheet.addRow(cells)
      } else if (!bucket.columns.length) {
        sheet.addRow({ msg: 'No rows found' })
      }
      // Data sheets are intentionally left unstyled — styling per row across
      // millions of rows blows up memory and slows the writer down. Only the
      // Summary sheet is styled.
      continue
    }

    for (const chunkFile of bucket.chunkFiles) {
      let firstRowSeen = false
      await streamChunkRows(chunkFile, (row) => {
        const fmtRow = formatQueryRow(row, modifyDates)
        if (!headersSet) {
          headers = Object.keys(fmtRow)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          headersSet = true
          rowsInSheet = 1
        }
        firstRowSeen = true
        if (rowsInSheet >= threshold) {
          rolloverIndex++
          const nextName = nextRolloverSheetName(baseSheetName, rolloverIndex, taken, willSplit)
          sheet = workbook.addWorksheet(nextName)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          rowsInSheet = 1
        }
        sheet.addRow(fmtRow)
        rowsInSheet++
      })
      // Empty chunk files are skipped silently to keep the sheet clean.
      void firstRowSeen
    }

    // No data-sheet styling — see Summary-only styling note above.
  }

  writeSummarySheet(
    workbook,
    jobName,
    progress,
    connections,
    queryNames,
    allBucketMeta,
    summaryExtraColumns
  )

  let fileDir = path.dirname(filePath)
  try {
    if (!fs.existsSync(fileDir)) await fs.promises.mkdir(fileDir, { recursive: true })
  } catch {
    // Destination directory inaccessible — fall back to Desktop/<AppName>/.
    fileDir = appDesktopBaseDir()
    await fs.promises.mkdir(fileDir, { recursive: true })
    filePath = path.join(fileDir, path.basename(filePath))
  }

  await workbook.xlsx.writeFile(filePath)
  return filePath
}

async function writeStreamingExcelReplace(
  filePath: string,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map(),
  preservedSheets: PreservedSheet[] = [],
  modifyDates = true,
  summaryExtraColumns: string[] = []
): Promise<string> {
  let resolvedDir = path.dirname(filePath)
  try {
    if (!fs.existsSync(resolvedDir)) await fs.promises.mkdir(resolvedDir, { recursive: true })
  } catch {
    // Destination directory inaccessible — fall back to Desktop/<AppName>/.
    resolvedDir = appDesktopBaseDir()
    await fs.promises.mkdir(resolvedDir, { recursive: true })
    filePath = path.join(resolvedDir, path.basename(filePath))
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false
  })

  try {
    const threshold = resolveSheetRowThreshold()
    const taken = new Set<string>()
    taken.add('summary')

    const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
    // Reserve preserved-sheet names so bucket sheets never collide with them.
    for (const ps of preservedSheets) taken.add(ps.name.toLowerCase())
    for (const bucket of buckets) {
      // Cancel does NOT abort the writer mid-flight: we let whatever data
      // was already streamed to disk be flushed to the output so users get
      // a usable file even when they cancel partway through.
      const baseSheetName = sanitizeSheetName(bucket.label)
      const willSplit = bucket.rows > threshold
      let rolloverIndex = 0
      let sheet = workbook.addWorksheet(nextRolloverSheetName(baseSheetName, 0, taken, willSplit))

      let headers: string[] = []
      let hasHeader = false
      let rowsInSheet = 0

      const writeHeader = (): void => {
        // Plain header row — no styling on data sheets (only Summary is styled).
        const hr = sheet.addRow(headers)
        hr.commit()
        rowsInSheet = 1
      }

      // Empty bucket — emit header + (optional) error row and move on.
      if (bucket.chunkFiles.length === 0) {
        if (bucket.columns.length > 0) {
          headers = bucket.error ? [...bucket.columns, 'Error'] : [...bucket.columns]
        } else if (bucket.error) {
          headers = ['Error']
        } else {
          headers = ['No rows found']
        }
        writeHeader()
        if (bucket.error) {
          const cells = headers.map((h) => (h === 'Error' ? bucket.error : ''))
          sheet.addRow(cells).commit()
        } else if (!bucket.columns.length) {
          sheet.addRow(['No rows found']).commit()
        }
        sheet.commit()
        continue
      }

      for (const chunkFile of bucket.chunkFiles) {
        await streamChunkRows(chunkFile, (row) => {
          if (!hasHeader) {
            headers = Object.keys(row)
            writeHeader()
            hasHeader = true
          }
          if (rowsInSheet >= threshold) {
            sheet.commit()
            rolloverIndex++
            sheet = workbook.addWorksheet(
              nextRolloverSheetName(baseSheetName, rolloverIndex, taken, willSplit)
            )
            writeHeader()
          }
          const values = headers.map(
            (key) => (modifyDates ? formatQueryValue(row[key]) : row[key]) as ExcelJS.CellValue
          )
          sheet.addRow(values).commit()
          rowsInSheet++
        })
      }

      sheet.commit()
    }

    // Re-emit preserved (user-added) sheets so a replace run never destroys
    // tabs the user manually created in the destination workbook.
    for (const ps of preservedSheets) {
      const ws = workbook.addWorksheet(ps.name)
      if (ps.columnWidths.length > 0) {
        ws.columns = ps.columnWidths.map((w) => ({ width: typeof w === 'number' ? w : 15 }))
      }
      for (const row of ps.rows) {
        ws.addRow(row).commit()
      }
      ws.commit()
    }

    const summary = workbook.addWorksheet('Summary')
    const startedAt = progress.started_at
    const finishedAt = progress.finished_at ?? new Date().toISOString()
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
    )
    const successCount = progress.total_connections - progress.failed_connections
    const errorRate =
      progress.total_connections > 0
        ? Math.round((progress.failed_connections / progress.total_connections) * 100)
        : 0

    // Build label map for Sheet Name column (single-query mode only)
    const isMultiQueryReplace = queryNames.length > 0
    const connLabelMapReplace = new Map<number, string>()
    for (const c of connections) {
      connLabelMapReplace.set(c.id, resolveConnectionLabel(c))
    }

    const extraColKeys = summaryExtraColumns.filter(Boolean)
    const extraLabels: Record<string, string> = {
      group_name: 'Group',
      store_name: 'Store',
      fiscal_year_name: 'Fiscal Year',
      static_ip: 'Static IP',
      vpn_ip: 'VPN IP',
      db_name: 'Database'
    }
    const groupMap = new Map<number, string>()
    const storeMap = new Map<number, string>()
    const fiscalYearMap = new Map<number, string>()
    if (extraColKeys.includes('group_name')) {
      for (const group of groupRepository.findAll()) groupMap.set(group.id, group.name)
    }
    if (extraColKeys.includes('store_name')) {
      for (const store of storeRepository.findAll()) storeMap.set(store.id, store.name)
    }
    if (extraColKeys.includes('fiscal_year_name')) {
      for (const fiscalYear of fiscalYearRepository.findAll()) {
        fiscalYearMap.set(fiscalYear.id, fiscalYear.name)
      }
    }
    const extraValuesFor = (connId: number): string[] => {
      const conn = connections.find((c) => c.id === connId)
      if (!conn) return extraColKeys.map(() => '')
      return extraColKeys.map((key) => {
        if (key === 'group_name') return conn.group_id ? (groupMap.get(conn.group_id) ?? '') : ''
        if (key === 'store_name') return conn.store_id ? (storeMap.get(conn.store_id) ?? '') : ''
        if (key === 'fiscal_year_name') {
          return conn.fiscal_year_id ? (fiscalYearMap.get(conn.fiscal_year_id) ?? '') : ''
        }
        if (key === 'static_ip') return conn.static_ip ?? ''
        if (key === 'vpn_ip') return conn.vpn_ip ?? ''
        if (key === 'db_name') return conn.db_name ?? ''
        return ''
      })
    }

    const summaryHeaders = [
      'Connection',
      'Sheet Name',
      ...extraColKeys.map((key) => extraLabels[key] ?? key),
      'Status',
      'Rows',
      'Started At',
      'Finished At',
      'Duration (s)',
      'Error Category',
      'Failure Reason'
    ]
    const summaryHeaderRow = summary.addRow(summaryHeaders)
    summaryHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    summaryHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' }
    }
    summaryHeaderRow.commit()

    summary
      .addRow([
        `Job: ${jobName}`,
        '',
        ...extraColKeys.map(() => ''),
        progress.status,
        progress.total_rows,
        formatUtcToIst(startedAt),
        formatUtcToIst(finishedAt),
        durationSeconds,
        categorizeError(progress.error),
        progress.error ?? ''
      ])
      .commit()

    summary
      .addRow([
        `Summary: ${successCount}/${progress.total_connections} successful`,
        '',
        ...extraColKeys.map(() => ''),
        progress.failed_connections > 0 ? 'partial' : 'ok',
        progress.total_rows,
        '',
        '',
        '',
        `${errorRate}% Error Rate`,
        progress.failed_connections > 0 ? `${progress.failed_connections} connection(s) failed` : ''
      ])
      .commit()

    summary.addRow([]).commit()

    for (const conn of progress.connections) {
      const connDuration =
        conn.started_at && conn.finished_at
          ? Math.max(
              0,
              Math.round(
                (new Date(conn.finished_at).getTime() - new Date(conn.started_at).getTime()) / 1000
              )
            )
          : 0

      const sheetLabelReplace = connLabelMapReplace.get(conn.connection_id) ?? conn.connection_name

      if (isMultiQueryReplace) {
        // Connection-level aggregate row (Sheet Name blank for parent row).
        summary
          .addRow([
            conn.connection_name,
            '',
            ...extraValuesFor(conn.connection_id),
            conn.status,
            conn.rows,
            formatUtcToIst(conn.started_at),
            formatUtcToIst(conn.finished_at),
            connDuration,
            categorizeError(conn.error),
            conn.error ?? ''
          ])
          .commit()
        const connRow = connections.find((c) => c.id === conn.connection_id)
        for (let qi = 0; qi < queryNames.length; qi++) {
          const tag = `c${conn.connection_id}-q${qi}`
          const meta = allBucketMeta.get(tag)
          const qLabel = queryNames[qi]?.trim() || `Query ${qi + 1}`
          const querySheetLabel = sanitizeSheetName(chunkSheetLabel(connRow, qi, queryNames))
          summary
            .addRow([
              `  ↳ ${qLabel}`,
              querySheetLabel,
              ...extraValuesFor(conn.connection_id),
              meta?.error ? 'error' : meta !== undefined ? 'done' : '',
              meta?.error ? 0 : (meta?.rows ?? 0),
              '',
              '',
              '',
              meta?.error ? categorizeError(meta.error) : '',
              meta?.error ?? ''
            ])
            .commit()
        }
      } else {
        summary
          .addRow([
            conn.connection_name,
            sheetLabelReplace,
            ...extraValuesFor(conn.connection_id),
            conn.status,
            conn.rows,
            formatUtcToIst(conn.started_at),
            formatUtcToIst(conn.finished_at),
            connDuration,
            categorizeError(conn.error),
            conn.error ?? ''
          ])
          .commit()
      }
    }

    summary.commit()
    await workbook.commit()
    return filePath
  } catch (err) {
    // Streaming WorkbookWriter has been appending to disk as we go, so any
    // failure leaves a partial .xlsx behind. Try to close the writer
    // cleanly, then remove the orphan file so the user never sees a
    // misleading half-written output. Cancel-mid-write is no longer
    // possible (writers don't throw on cancel), so we don't need a
    // separate cancel-cleanup branch here.
    try {
      await workbook.commit()
    } catch {
      // ignore — writer may already be in a bad state
    }
    try {
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
    } catch {
      // best-effort cleanup
    }
    throw err
  }
}

// ─── Summary sheet ────────────────────────────────────────────────────────────

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[] = [],
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map(),
  summaryExtraColumns: string[] = []
): void {
  const existing = workbook.getWorksheet('Summary')
  if (existing) workbook.removeWorksheet(existing.id)

  const sheet = workbook.addWorksheet('Summary')
  const startedAt = progress.started_at
  const finishedAt = progress.finished_at ?? new Date().toISOString()
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  )
  const successCount = progress.total_connections - progress.failed_connections
  const errorRate =
    progress.total_connections > 0
      ? Math.round((progress.failed_connections / progress.total_connections) * 100)
      : 0

  // Build a map from connection_id → resolved sheet label (store code/name/connection name)
  const connLabelMap = new Map<number, string>()
  for (const c of connections) {
    connLabelMap.set(c.id, resolveConnectionLabel(c))
  }

  const isMultiQuery = queryNames.length > 0

  // Build lookup maps for extra column resolution (group, store, fiscal year)
  const extraColKeys = summaryExtraColumns.filter(Boolean)
  const needsGroupLookup = extraColKeys.includes('group_name')
  const needsStoreLookup = extraColKeys.includes('store_name')
  const needsFiscalLookup = extraColKeys.includes('fiscal_year_name')

  const groupMap = new Map<number, string>()
  const storeMap = new Map<number, string>()
  const fiscalYearMap = new Map<number, string>()

  if (needsGroupLookup) {
    for (const g of groupRepository.findAll()) groupMap.set(g.id, g.name)
  }
  if (needsStoreLookup) {
    for (const s of storeRepository.findAll()) storeMap.set(s.id, s.name)
  }
  if (needsFiscalLookup) {
    for (const fy of fiscalYearRepository.findAll()) fiscalYearMap.set(fy.id, fy.name)
  }

  /** Return the extra column values for a given connection (keyed by column key). */
  function getExtraValues(connId: number): Record<string, string> {
    const conn = connections.find((c) => c.id === connId)
    if (!conn || !extraColKeys.length) return {}
    const vals: Record<string, string> = {}
    for (const key of extraColKeys) {
      switch (key) {
        case 'group_name':
          vals[key] = conn.group_id ? (groupMap.get(conn.group_id) ?? '') : ''
          break
        case 'store_name':
          vals[key] = conn.store_id ? (storeMap.get(conn.store_id) ?? '') : ''
          break
        case 'fiscal_year_name':
          vals[key] = conn.fiscal_year_id ? (fiscalYearMap.get(conn.fiscal_year_id) ?? '') : ''
          break
        case 'static_ip':
          vals[key] = conn.static_ip ?? ''
          break
        case 'vpn_ip':
          vals[key] = conn.vpn_ip ?? ''
          break
        case 'db_name':
          vals[key] = conn.db_name ?? ''
          break
        default:
          vals[key] = ''
      }
    }
    return vals
  }

  const extraColumnDefs: Partial<ExcelJS.Column>[] = extraColKeys.map((key) => {
    const labels: Record<string, string> = {
      group_name: 'Group',
      store_name: 'Store',
      fiscal_year_name: 'Fiscal Year',
      static_ip: 'Static IP',
      vpn_ip: 'VPN IP',
      db_name: 'Database'
    }
    return { header: labels[key] ?? key, key, width: 20 }
  })

  // Sheet Name is now shown in BOTH single- and multi-query mode so users can
  // always trace a row back to the worksheet that holds its data.
  sheet.columns = [
    { header: 'Connection', key: 'connection_name', width: 28 },
    { header: 'Sheet Name', key: 'sheet_name', width: 22 },
    ...extraColumnDefs,
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Rows', key: 'rows', width: 10 },
    { header: 'Started At', key: 'started_at', width: 24 },
    { header: 'Finished At', key: 'finished_at', width: 24 },
    { header: 'Duration (s)', key: 'duration_seconds', width: 14 },
    { header: 'Error Category', key: 'error_category', width: 18 },
    { header: 'Failure Reason', key: 'failure_reason', width: 50 }
  ]

  applyHeaderStyle(sheet, 1, 'FF0F766E')
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  sheet.addRow({
    connection_name: `Job: ${jobName}`,
    status: progress.status,
    rows: progress.total_rows,
    started_at: formatUtcToIst(startedAt),
    finished_at: formatUtcToIst(finishedAt),
    duration_seconds: durationSeconds,
    failure_reason: progress.error ?? '',
    error_category: categorizeError(progress.error)
  })
  sheet.addRow({
    connection_name: `Summary: ${successCount}/${progress.total_connections} successful`,
    status: progress.failed_connections > 0 ? 'partial' : 'ok',
    rows: progress.total_rows,
    started_at: '',
    finished_at: '',
    duration_seconds: '',
    error_category: `${errorRate}% Error Rate`,
    failure_reason:
      progress.failed_connections > 0 ? `${progress.failed_connections} connection(s) failed` : ''
  })
  sheet.addRow({
    connection_name: '',
    status: '',
    rows: '',
    started_at: '',
    finished_at: '',
    duration_seconds: '',
    failure_reason: '',
    error_category: ''
  })

  const jobRow = sheet.getRow(2)
  jobRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }
    cell.font = { bold: true, color: { argb: 'FF0C4A6E' } }
  })

  const summaryRow = sheet.getRow(3)
  summaryRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } }
    cell.font = { bold: true, color: { argb: 'FF7C2D12' } }
  })

  applyStatusStyle(sheet.getCell('B2'), String(progress.status))
  applyStatusStyle(sheet.getCell('B3'), progress.failed_connections > 0 ? 'partial' : 'ok')

  for (const conn of progress.connections) {
    const connDuration =
      conn.started_at && conn.finished_at
        ? Math.max(
            0,
            Math.round(
              (new Date(conn.finished_at).getTime() - new Date(conn.started_at).getTime()) / 1000
            )
          )
        : 0

    const sheetLabel = connLabelMap.get(conn.connection_id) ?? conn.connection_name

    if (isMultiQuery) {
      // In multi-query mode: show one sub-row per query beneath the connection row.
      // Connection row shows aggregated totals; sheet_name is left blank.
      sheet.addRow({
        connection_name: conn.connection_name,
        sheet_name: '',
        ...getExtraValues(conn.connection_id),
        status: conn.status,
        rows: conn.rows,
        started_at: formatUtcToIst(conn.started_at),
        finished_at: formatUtcToIst(conn.finished_at),
        duration_seconds: connDuration,
        failure_reason: conn.error ?? '',
        error_category: categorizeError(conn.error)
      })
      // One row per query — show the resolved sheet name + actual row count.
      const connRow = connections.find((c) => c.id === conn.connection_id)
      for (let qi = 0; qi < queryNames.length; qi++) {
        const tag = `c${conn.connection_id}-q${qi}`
        const meta = allBucketMeta.get(tag)
        const qLabel = queryNames[qi]?.trim() || `Query ${qi + 1}`
        const querySheetLabel = sanitizeSheetName(chunkSheetLabel(connRow, qi, queryNames))
        sheet.addRow({
          connection_name: `  ↳ ${qLabel}`,
          sheet_name: querySheetLabel,
          status: meta?.error ? 'error' : meta !== undefined ? 'done' : '',
          rows: meta?.error ? 0 : (meta?.rows ?? 0),
          started_at: '',
          finished_at: '',
          duration_seconds: '',
          failure_reason: meta?.error ?? '',
          error_category: meta?.error ? categorizeError(meta.error) : ''
        })
      }
    } else {
      sheet.addRow({
        connection_name: conn.connection_name,
        sheet_name: sheetLabel,
        ...getExtraValues(conn.connection_id),
        status: conn.status,
        rows: conn.rows,
        started_at: formatUtcToIst(conn.started_at),
        finished_at: formatUtcToIst(conn.finished_at),
        duration_seconds: connDuration,
        failure_reason: conn.error ?? '',
        error_category: categorizeError(conn.error)
      })
    }
  }

  const firstConnRow = 5
  for (let i = firstConnRow; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    if (i % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      })
    }
    applyStatusStyle(sheet.getCell(`B${i}`), String(sheet.getCell(`B${i}`).value ?? ''))
  }

  sheet.columns.forEach((col) => {
    const headerText = col.header ? String(col.header) : ''
    let max = Math.max(12, headerText.length + 2)
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value
      const text = v === null || v === undefined ? '' : String(v)
      max = Math.max(max, Math.min(65, text.length + 2))
    })
    col.width = max
  })
}

function buildGoogleSheetsSummaryRows(
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[] = [],
  bucketTargets: GoogleSheetBucketTarget[] = [],
  summaryExtraColumns: string[] = []
): Array<Array<string | number | boolean>> {
  const startedAt = progress.started_at
  const finishedAt = progress.finished_at ?? new Date().toISOString()
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  )
  const successCount = progress.total_connections - progress.failed_connections
  const errorRate =
    progress.total_connections > 0
      ? Math.round((progress.failed_connections / progress.total_connections) * 100)
      : 0

  const bucketByConnectionId = new Map<number, GoogleSheetBucketTarget>()
  for (const target of bucketTargets) {
    if (
      typeof target.bucket.connectionId === 'number' &&
      !bucketByConnectionId.has(target.bucket.connectionId)
    ) {
      bucketByConnectionId.set(target.bucket.connectionId, target)
    }
  }

  const extraColKeys = summaryExtraColumns.filter(Boolean)
  const needsGroupLookup = extraColKeys.includes('group_name')
  const needsStoreLookup = extraColKeys.includes('store_name')
  const needsFiscalLookup = extraColKeys.includes('fiscal_year_name')

  const groupMap = new Map<number, string>()
  const storeMap = new Map<number, string>()
  const fiscalYearMap = new Map<number, string>()

  if (needsGroupLookup) {
    for (const group of groupRepository.findAll()) groupMap.set(group.id, group.name)
  }
  if (needsStoreLookup) {
    for (const store of storeRepository.findAll()) storeMap.set(store.id, store.name)
  }
  if (needsFiscalLookup) {
    for (const fiscalYear of fiscalYearRepository.findAll()) {
      fiscalYearMap.set(fiscalYear.id, fiscalYear.name)
    }
  }

  function getExtraValues(connId: number): string[] {
    const conn = connections.find((connection) => connection.id === connId)
    if (!conn || extraColKeys.length === 0) return []

    return extraColKeys.map((key) => {
      switch (key) {
        case 'group_name':
          return conn.group_id ? (groupMap.get(conn.group_id) ?? '') : ''
        case 'store_name':
          return conn.store_id ? (storeMap.get(conn.store_id) ?? '') : ''
        case 'fiscal_year_name':
          return conn.fiscal_year_id ? (fiscalYearMap.get(conn.fiscal_year_id) ?? '') : ''
        case 'static_ip':
          return conn.static_ip ?? ''
        case 'vpn_ip':
          return conn.vpn_ip ?? ''
        case 'db_name':
          return conn.db_name ?? ''
        default:
          return ''
      }
    })
  }

  const extraColumnLabels = extraColKeys.map((key) => {
    const labels: Record<string, string> = {
      group_name: 'Group',
      store_name: 'Store',
      fiscal_year_name: 'Fiscal Year',
      static_ip: 'Static IP',
      vpn_ip: 'VPN IP',
      db_name: 'Database'
    }

    return labels[key] ?? key
  })

  const headers = [
    'Connection',
    'Sheet Name',
    ...extraColumnLabels,
    'Status',
    'Rows',
    'Started At',
    'Finished At',
    'Duration (s)',
    'Error Category',
    'Failure Reason'
  ]
  const blankRow = headers.map(() => '')
  const rows: Array<Array<string | number | boolean>> = [headers]

  rows.push([
    `Job: ${jobName}`,
    '',
    ...extraColKeys.map(() => ''),
    progress.status,
    progress.total_rows,
    formatUtcToIst(startedAt),
    formatUtcToIst(finishedAt),
    durationSeconds,
    categorizeError(progress.error),
    progress.error ?? ''
  ])

  rows.push([
    `Summary: ${successCount}/${progress.total_connections} successful`,
    '',
    ...extraColKeys.map(() => ''),
    progress.failed_connections > 0 ? 'partial' : 'ok',
    progress.total_rows,
    '',
    '',
    '',
    `${errorRate}% Error Rate`,
    progress.failed_connections > 0 ? `${progress.failed_connections} connection(s) failed` : ''
  ])

  rows.push(blankRow)

  for (const conn of progress.connections) {
    const bucketTarget = bucketByConnectionId.get(conn.connection_id)
    const connDuration =
      conn.started_at && conn.finished_at
        ? Math.max(
            0,
            Math.round(
              (new Date(conn.finished_at).getTime() - new Date(conn.started_at).getTime()) / 1000
            )
          )
        : 0
    const failureReason = conn.error ?? bucketTarget?.bucket.error ?? ''

    rows.push([
      conn.connection_name,
      bucketTarget?.tabName ?? '',
      ...getExtraValues(conn.connection_id),
      conn.status,
      bucketTarget?.bucket.rowCount ?? conn.rows,
      formatUtcToIst(conn.started_at),
      formatUtcToIst(conn.finished_at),
      connDuration,
      categorizeError(failureReason),
      failureReason
    ])
  }

  return rows
}

function estimateGoogleSheetBucketWriteRows(bucket: GsheetBucket): number {
  return Math.max(bucket.rowCount ?? 0, 1) + 1
}

function estimateGoogleSheetTotalWriteRows(args: {
  buckets: GsheetBucket[]
  combineSheets: boolean
  summaryRows: Array<Array<string | number | boolean>>
}): number {
  const bucketRows = args.buckets.reduce(
    (total, bucket) => total + estimateGoogleSheetBucketWriteRows(bucket),
    0
  )
  const combinedDataRows = args.combineSheets
    ? Math.max(
        args.buckets.reduce((total, bucket) => total + Math.max(bucket.rowCount ?? 0, 0), 0),
        1
      ) + 1
    : 0
  const summaryRows = args.summaryRows.length

  return bucketRows + combinedDataRows + summaryRows
}

// ─── CSV writer (for large datasets / backpressure fallback) ─────────────────

/**
 * Escape a cell for CSV per RFC 4180. Wraps in quotes if it contains comma,
 * double-quote, newline, or carriage return; internal quotes are doubled.
 */
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function writeCsvPayload(stream: fs.WriteStream, payload: string): Promise<void> {
  if (!payload) return
  if (!stream.write(payload)) {
    await new Promise<void>((resolve) => stream.once('drain', resolve))
  }
}

interface DirectCsvConnectionState {
  filePath: string
  stream: fs.WriteStream
  headers: string[] | null
}

interface DirectCsvContext {
  outDir: string
  byConnection: Map<number, DirectCsvConnectionState>
  totalRowsWritten: number
}

async function resolveCsvOutputDir(destPath: string, jobName: string): Promise<string> {
  let outDir: string
  if (isDirectoryPath(destPath)) {
    outDir = path.join(destPath, `${sanitizeFileName(jobName)}_${fileTimestamp()}`)
  } else {
    const parsed = path.parse(destPath)
    outDir = path.join(parsed.dir, `${parsed.name}_${fileTimestamp()}`)
  }
  try {
    await fs.promises.mkdir(outDir, { recursive: true })
  } catch {
    // Configured destination is inaccessible (missing drive, network path, etc.).
    // Fall back to Desktop/<AppName>/<jobName>_<timestamp>/.
    outDir = path.join(appDesktopBaseDir(), `${sanitizeFileName(jobName)}_${fileTimestamp()}`)
    await fs.promises.mkdir(outDir, { recursive: true })
  }
  return outDir
}

async function createDirectCsvContext(
  destPath: string,
  jobName: string
): Promise<DirectCsvContext> {
  return {
    outDir: await resolveCsvOutputDir(destPath, jobName),
    byConnection: new Map(),
    totalRowsWritten: 0
  }
}

function ensureDirectCsvConnection(
  context: DirectCsvContext,
  conn: ConnectionRow
): DirectCsvConnectionState {
  const existing = context.byConnection.get(conn.id)
  if (existing) return existing

  const filePath = path.join(
    context.outDir,
    `${sanitizeFileName(resolveConnectionLabel(conn))}.csv`
  )
  const stream = fs.createWriteStream(filePath, {
    encoding: 'utf-8',
    highWaterMark: 1024 * 1024
  })
  const state: DirectCsvConnectionState = {
    filePath,
    stream,
    headers: null
  }
  context.byConnection.set(conn.id, state)
  return state
}

async function closeDirectCsvConnection(context: DirectCsvContext, connId: number): Promise<void> {
  const state = context.byConnection.get(connId)
  if (!state) return
  await new Promise<void>((resolve, reject) => {
    state.stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
  })
  context.byConnection.delete(connId)
}

async function resetDirectCsvConnection(context: DirectCsvContext, connId: number): Promise<void> {
  const state = context.byConnection.get(connId)
  if (!state) return
  await closeDirectCsvConnection(context, connId)
  try {
    if (fs.existsSync(state.filePath)) {
      await fs.promises.rm(state.filePath, { force: true })
    }
  } catch {
    // best effort
  }
}

async function writeDirectCsvRows(
  context: DirectCsvContext,
  conn: ConnectionRow,
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return context.totalRowsWritten

  const state = ensureDirectCsvConnection(context, conn)
  if (!state.headers) {
    state.headers = Object.keys(rows[0])
    await writeCsvPayload(state.stream, state.headers.map(csvEscape).join(',') + '\n')
  }

  const headers = state.headers
  const payload =
    rows
      .map((row) => headers.map((h) => csvEscape((row as Record<string, unknown>)[h])).join(','))
      .join('\n') + '\n'
  await writeCsvPayload(state.stream, payload)
  context.totalRowsWritten += rows.length
  return context.totalRowsWritten
}

async function finalizeDirectCsvOutput(
  context: DirectCsvContext,
  progress: JobProgress
): Promise<string> {
  const openConnIds = Array.from(context.byConnection.keys())
  for (const connId of openConnIds) {
    await closeDirectCsvConnection(context, connId)
  }

  const summaryPath = path.join(context.outDir, '_summary.csv')
  const summaryRows: string[] = []
  summaryRows.push(
    ['Connection', 'Status', 'Rows', 'Started At', 'Finished At', 'Error'].map(csvEscape).join(',')
  )
  for (const conn of progress.connections) {
    summaryRows.push(
      [
        conn.connection_name,
        conn.status,
        conn.rows,
        conn.started_at ?? '',
        conn.finished_at ?? '',
        conn.error ?? ''
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  await fs.promises.writeFile(summaryPath, summaryRows.join('\n') + '\n', 'utf-8')
  return context.outDir
}

async function disposeDirectCsvContext(context: DirectCsvContext): Promise<void> {
  const openConnIds = Array.from(context.byConnection.keys())
  for (const connId of openConnIds) {
    try {
      await closeDirectCsvConnection(context, connId)
    } catch {
      // best effort
    }
  }
}

/**
 * Write a header + single error row CSV file for a connection that failed
 * (or returned zero rows) in direct-CSV streaming mode. Mirrors the empty
 * Excel sheet behaviour so users always get a diagnostic artefact per
 * connection.
 */
async function writeDirectCsvErrorFile(
  context: DirectCsvContext,
  conn: ConnectionRow,
  columns: string[],
  error: string
): Promise<void> {
  const filePath = path.join(
    context.outDir,
    `${sanitizeFileName(resolveConnectionLabel(conn))}.csv`
  )
  const headers = columns.length > 0 ? [...columns, 'Error'] : ['Error']
  const headerLine = headers.map(csvEscape).join(',')
  const errorRow =
    columns.length > 0
      ? [...columns.map(() => ''), error].map(csvEscape).join(',')
      : csvEscape(error)
  await fs.promises.writeFile(filePath, `${headerLine}\n${errorRow}\n`, 'utf-8')
}

/**
 * Writes one CSV file per connection into the destination directory.
 * Returns the directory path.
 */
async function writeStreamingCsv(
  destPath: string,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  hooks?: {
    isCancelled?: () => boolean
    onChunkWritten?: (chunkRows: number, totalRowsWritten: number, targetRows: number) => void
  },
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map()
): Promise<string> {
  const outDir = await resolveCsvOutputDir(destPath, jobName)

  const CSV_ROWS_PER_WRITE = 1000
  let totalRowsWritten = 0

  const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
  for (const bucket of buckets) {
    const filePath = path.join(outDir, `${sanitizeFileName(bucket.label)}.csv`)
    const stream = fs.createWriteStream(filePath, {
      encoding: 'utf-8',
      highWaterMark: 1024 * 1024
    })
    try {
      let headers: string[] | null = null

      // Bucket has no rows but has an error → emit header (columns + Error)
      // and a single row with the failure reason so the artefact is useful.
      if (bucket.chunkFiles.length === 0 && bucket.error) {
        const cols = bucket.columns.length > 0 ? [...bucket.columns, 'Error'] : ['Error']
        await writeCsvPayload(stream, cols.map(csvEscape).join(',') + '\n')
        const errorCells =
          bucket.columns.length > 0
            ? [...bucket.columns.map(() => ''), bucket.error]
            : [bucket.error]
        await writeCsvPayload(stream, errorCells.map(csvEscape).join(',') + '\n')
        continue
      }

      // Header-only file when columns are known but no rows arrived (only
      // happens when excel_create_empty_sheets is on and there's no error).
      if (bucket.chunkFiles.length === 0) {
        if (bucket.columns.length > 0) {
          await writeCsvPayload(stream, bucket.columns.map(csvEscape).join(',') + '\n')
        }
        continue
      }

      for (const chunkFile of bucket.chunkFiles) {
        if (hooks?.isCancelled?.()) {
          throw new Error('Job cancelled by user during CSV writing')
        }

        const rows = await readChunkFromFile(chunkFile)
        if (rows.length === 0) continue

        if (!headers) {
          headers = Object.keys(rows[0])
          await writeCsvPayload(stream, headers.map(csvEscape).join(',') + '\n')
        }

        // Batch rows into larger payloads to reduce stream.write syscall overhead.
        for (let i = 0; i < rows.length; i += CSV_ROWS_PER_WRITE) {
          const slice = rows.slice(i, i + CSV_ROWS_PER_WRITE)
          const payload =
            slice
              .map((row) =>
                headers!.map((h) => csvEscape((row as Record<string, unknown>)[h])).join(',')
              )
              .join('\n') + '\n'
          await writeCsvPayload(stream, payload)

          if (hooks?.isCancelled?.()) {
            throw new Error('Job cancelled by user during CSV writing')
          }
        }

        totalRowsWritten += rows.length
        hooks?.onChunkWritten?.(rows.length, totalRowsWritten, progress.total_rows)
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
    }
  }

  // Write _summary.csv alongside the connection files
  const summaryPath = path.join(outDir, '_summary.csv')
  const summaryRows: string[] = []
  summaryRows.push(
    ['Connection', 'Status', 'Rows', 'Started At', 'Finished At', 'Error'].map(csvEscape).join(',')
  )
  for (const conn of progress.connections) {
    summaryRows.push(
      [
        conn.connection_name,
        conn.status,
        conn.rows,
        formatUtcToIst(conn.started_at),
        formatUtcToIst(conn.finished_at),
        conn.error ?? ''
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  await fs.promises.writeFile(summaryPath, summaryRows.join('\n') + '\n', 'utf-8')

  return outDir
}

// ─── API sender (streaming batches) ──────────────────────────────────────────

async function sendToApiStreaming(
  configJson: string,
  connections: ConnectionRow[],
  allChunkFiles: Map<string, string[]>,
  onConnectionSuccess?: (connId: number) => Promise<void>
): Promise<void> {
  const config = JSON.parse(configJson) as {
    endpoint: string
    method: string
    headers: string
    batch_size?: number
  }
  const url = config.endpoint
  const method = (config.method || 'POST').toUpperCase()
  const batchSize = config.batch_size || 1000

  let headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.headers) {
    const rawHeaders = config.headers.trim()
    let parsed: Record<string, string> | null = null

    // Attempt 1: parse as-is (valid JSON object)
    try {
      const p = JSON.parse(rawHeaders)
      if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p
    } catch {
      // ignore
    }

    // Attempt 2: wrap in {} in case user omitted outer braces
    // e.g.  "x-machine-sync-token": "abc"
    if (!parsed) {
      try {
        const p = JSON.parse(`{${rawHeaders}}`)
        if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p
      } catch {
        // ignore
      }
    }

    // Attempt 3: Key: Value line-by-line (strip surrounding quotes from both key and val)
    if (!parsed) {
      const extra: Record<string, string> = {}
      for (const line of rawHeaders.split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
          const key = line
            .slice(0, colonIdx)
            .trim()
            .replace(/^["']|["']$/g, '')
          const val = line
            .slice(colonIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, '')
            .replace(/,\s*$/, '')
          if (key && val) extra[key] = val
        }
      }
      if (Object.keys(extra).length > 0) parsed = extra
    }

    if (parsed) {
      // Strip any remaining quotes from keys (safety net for all parse paths)
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        const cleanKey = k.trim().replace(/^["']|["']$/g, '')
        const cleanVal = String(v)
          .trim()
          .replace(/^["']|["']$/g, '')
        if (cleanKey) clean[cleanKey] = cleanVal
      }
      headers = { ...headers, ...clean }
    }
  }

  const buckets = listOutputBuckets(connections, allChunkFiles)
  for (const bucket of buckets) {
    const conn = bucket.connection
    if (!conn) continue
    let batch: Record<string, unknown>[] = []

    for (const chunkFile of bucket.chunkFiles) {
      const rows = await readChunkFromFile(chunkFile)
      for (const row of rows) {
        batch.push(row)
        if (batch.length >= batchSize) {
          await sendBatch(url, method, headers, conn, batch)
          batch = []
        }
      }
    }

    if (batch.length > 0) {
      await sendBatch(url, method, headers, conn, batch)
    }

    // All batches for this connection sent successfully — fire the callback
    // so the caller can update variables now that data has actually reached
    // the destination.
    if (onConnectionSuccess) {
      await onConnectionSuccess(conn.id).catch(() => {})
    }
  }
}

async function sendBatch(
  url: string,
  method: string,
  headers: Record<string, string>,
  conn: ConnectionRow,
  rows: Record<string, unknown>[]
): Promise<void> {
  const payload = {
    connection: { id: conn.id, name: conn.name, database: conn.db_name },
    rows,
    row_count: rows.length,
    timestamp: new Date().toISOString()
  }

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    // Try to read the response body for a more descriptive error message
    let bodyText = ''
    try {
      bodyText = await res.text()
      // If body is JSON, try to extract a message field
      const bodyJson = JSON.parse(bodyText) as Record<string, unknown>
      const msg =
        (bodyJson.message as string) ||
        (bodyJson.error as string) ||
        (bodyJson.msg as string) ||
        (bodyJson.detail as string)
      if (msg) bodyText = msg
    } catch {
      // bodyText stays as raw text or empty
    }
    const detail = bodyText ? ` — ${bodyText.slice(0, 300)}` : ''
    throw new Error(
      `API ${method} ${url} failed for "${conn.name}": ${res.status} ${res.statusText}${detail}`
    )
  }
}

// ─── Main executor — crash-proof, streaming, memory-safe ──────────────────────

export async function runJob(
  jobId: number,
  webContents: WebContents,
  options?: JobRunOptions
): Promise<JobProgress> {
  if (runningJobs.has(jobId)) {
    return runningJobs.get(jobId)!
  }

  const job = jobRepository.findById(jobId)
  if (!job) throw new Error(`Job #${jobId} not found`)

  if (job.type === 'action') {
    // Delegate action jobs to action executor (currently scaffolded).
    return runActionJob(jobId, webContents)
  }

  // Apply per-invocation overrides from the run dialog. We do NOT persist these;
  // the DB job row is the canonical config.
  const effectiveOnlineOnly =
    typeof options?.online_only === 'boolean' ? options.online_only : job.online_only

  // Excel destination must always produce output, even when the job has no
  // path configured or the configured path is unreachable. Fall back to
  // `Desktop/Job_Output/` so the run is never silently dropped.
  const isExcelDestination = !job.destination_type || job.destination_type === 'excel'
  let effectiveDestinationConfig: string | null = job.destination_config
  if (isExcelDestination) {
    // Excel always writes to Desktop/Job_Output/<job>/ so assigned
    // users never depend on another machine's local path.
    const fallback = path.join(appDesktopBaseDir(), sanitizeFileName(job.name))
    try {
      fs.mkdirSync(fallback, { recursive: true })
    } catch {
      // mkdir failures surface later when the writer attempts the same path
    }
    effectiveDestinationConfig = fallback
  }

  const settings = settingsRepo.getAll()
  const jobTimeoutSec = Math.max(5, settings.job_query_timeout)

  const connIds = Array.isArray(job.connection_ids) ? job.connection_ids : []
  const selectedConnections = connIds
    .map((id) => connectionRepo.findById(id))
    .filter((c): c is ConnectionRow => c !== undefined)

  // Optional retry filter from the run dialog: when set, only run the listed
  // connection IDs. Used by "Retry failed connections" so users don't redo
  // the successful ones from the previous run.
  const retryFilter =
    Array.isArray(options?.connection_ids) && options.connection_ids.length > 0
      ? new Set(options.connection_ids)
      : null
  const filteredConnections = retryFilter
    ? selectedConnections.filter((c) => retryFilter.has(c.id))
    : selectedConnections

  const connections = effectiveOnlineOnly
    ? filteredConnections.filter((conn) => conn.status === 'online')
    : filteredConnections

  if (connections.length === 0) {
    throw new Error(
      effectiveOnlineOnly
        ? 'No online connections available for this job'
        : 'No valid connections found for this job'
    )
  }

  const queries = Array.isArray(job.sql_query) ? job.sql_query : []
  if (queries.length === 0 || queries.every((q) => !q.trim())) {
    throw new Error('No SQL queries defined for this job')
  }

  // ── Job Variables: load per-connection checkpoints + variable meta ─────────
  const jobVarMeta = jobVariableRepository.getVariableMetaForJob(jobId)
  // connVarMap: Map<connectionId, Record<varName, value>>
  const connVarMap = jobVariableRepository.getValueMapForJob(jobId)

  const progress: JobProgress = {
    job_id: jobId,
    job_name: job.name,
    status: 'running',
    total_connections: connections.length,
    completed_connections: 0,
    failed_connections: 0,
    total_rows: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    connections: connections.map((c) => ({
      connection_id: c.id,
      connection_name: c.name,
      status: 'pending' as const,
      rows: 0,
      error: null,
      started_at: null,
      finished_at: null
    })),
    error: null,
    output_path: null,
    adaptive: null
  }

  runningJobs.set(jobId, progress)
  cancelledJobs.delete(jobId)
  jobRetries.set(jobId, new Map())
  const abortHandle = registerJobAbortHandle(jobId)

  jobRepository.update(jobId, { status: 'running' } as Partial<JobRow>)

  const throttled = createThrottledEmit(webContents)
  throttled.emit(progress)

  const allChunkFiles = new Map<string, string[]>()
  const allBucketMeta = new Map<string, BucketMeta>()
  const isMultiQuery = queries.length > 1 && job.is_multi === true
  const configuredMax = Math.max(
    1,
    Math.min(settings.job_concurrent_connections, connections.length)
  )
  const maxRetries = Math.max(0, settings.job_max_retries)

  // Excel destinations always produce an Excel workbook, regardless of size.
  // We deliberately skip the legacy CSV-downgrade preflight here so a job
  // with millions of rows still ends up as `.xlsx` (split across `_part1`,
  // `_part2`, … sheets when it exceeds the per-sheet row threshold).
  // The CSV-streaming helpers (`estimateRowsForSampleConnection`,
  // `createDirectCsvContext`, `finalizeDirectCsvOutput`, `writeStreamingCsv`)
  // are kept around as dead code for now in case the toggle returns later.
  void estimateRowsForSampleConnection
  void createDirectCsvContext
  void finalizeDirectCsvOutput
  void writeStreamingCsv
  const directCsvContext: DirectCsvContext | null = null // ── Adaptive Brain wiring ───────────────────────────────────────────────
  const brain = getAdaptiveBrain()
  brain.start()

  let activeWorkers = 0
  let targetWorkers = configuredMax
  const workerBounds = { min: 1, max: configuredMax }

  const getSnapshot = (): HealthSnapshot | null => brain.getSnapshot()
  const isBackpressured = (): boolean => getSnapshot()?.backpressure === true
  const isCancelled = (): boolean => cancelledJobs.has(jobId)

  // Initial (empty) adaptive state — refined on first snapshot
  const initialFormatDecision = decideOutputFormat({
    totalRows: 0,
    connectionCount: connections.length,
    maxParallel: configuredMax,
    memoryUsage: 0,
    preferred: 'auto'
  })
  progress.adaptive = {
    health_score: 1,
    cpu: 0,
    memory: 0,
    lag_ms: 0,
    throughput: 0,
    backpressure: false,
    reason: 'warming up',
    active_workers: 0,
    target_workers: targetWorkers,
    output_format: isExcelDestination ? 'excel-stream' : null,
    output_reason: isExcelDestination
      ? 'excel destination — streaming workbook'
      : initialFormatDecision.reason,
    output_progress_pct: null,
    output_progress_label: null
  }

  const updateAdaptiveState = (): void => {
    const snap = getSnapshot()
    if (!snap) return
    progress.adaptive = {
      health_score: snap.score,
      cpu: snap.cpu,
      memory: snap.memory,
      lag_ms: snap.lagMs,
      throughput: snap.throughput,
      backpressure: snap.backpressure,
      reason: snap.reason,
      active_workers: activeWorkers,
      target_workers: targetWorkers,
      output_format: progress.adaptive?.output_format ?? null,
      output_reason: progress.adaptive?.output_reason ?? null,
      output_progress_pct: progress.adaptive?.output_progress_pct ?? null,
      output_progress_label: progress.adaptive?.output_progress_label ?? null
    }
  }

  // Brain → update error rate from current counters periodically
  const unsubscribe = brain.subscribe(() => {
    if (progress.total_connections > 0) {
      brain.setErrorRate(progress.failed_connections / progress.total_connections)
    }
    updateAdaptiveState()
    throttled.emit(progress)
  })

  // ── Shared worker queue ─────────────────────────────────────────────────
  let currentIndex = 0

  const startWorker = async (slot: number): Promise<void> => {
    activeWorkers++
    updateAdaptiveState()
    try {
      while (currentIndex < connections.length) {
        if (isCancelled()) break
        // Honor scale-down: a worker beyond the target exits gracefully
        if (slot >= targetWorkers) break

        // Backpressure gate — pause before picking up a new connection
        await waitForPressureClear(isBackpressured, isCancelled)
        if (isCancelled()) break

        const index = currentIndex
        currentIndex++

        const conn = connections[index]
        const connProgress = progress.connections[index]
        if (!conn || !connProgress) {
          // Defensive: should never happen, but if array bounds ever drift
          // (stale callbacks, concurrent mutation) skip this slot instead of
          // crashing the whole job.
          continue
        }
        const retryMap = jobRetries.get(jobId)!

        throttled.emit(progress)

        // Resolve per-connection variable values for query injection
        const connVars = connVarMap.get(conn.id) ?? {}

        // Multi-query jobs produce one output bucket (sheet / CSV) per query
        // per connection. Single-query jobs use one bucket per connection.
        const plan = isMultiQuery
          ? queries.map((q, qIdx) => ({
              queries: [injectVariables(q, connVars, jobVarMeta)],
              tag: chunkTagFor(conn.id, qIdx),
              queryIdx: qIdx as number | null
            }))
          : [
              {
                queries: queries.map((q) => injectVariables(q, connVars, jobVarMeta)),
                tag: chunkTagFor(conn.id, null),
                queryIdx: null as number | null
              }
            ]

        let aggregateRows = 0
        let aggregateError: string | null = null
        const aggregateChunkFiles: Array<{ tag: string; files: string[] }> = []
        const aggregateBucketMeta: Array<{
          tag: string
          columns: string[]
          error: string | null
          rows: number
        }> = []

        for (const step of plan) {
          if (isCancelled()) break

          let result: StreamingConnectionResult | null = null
          let attempts = 0

          while (attempts <= maxRetries) {
            try {
              if (directCsvContext && attempts > 0) {
                await resetDirectCsvConnection(directCsvContext, conn.id)
              }

              result = await executeStreamingForConnection(
                conn,
                step.queries,
                connProgress,
                jobTimeoutSec,
                jobId,
                step.tag,
                (rows) => {
                  connProgress.rows = aggregateRows + rows
                  throttled.emit(progress)
                },
                {
                  recordRows: (n) => brain.recordRows(n),
                  isBackpressured,
                  isCancelled,
                  abortHandle,
                  writeRows: directCsvContext
                    ? async (rows) => {
                        const totalRowsWritten = await writeDirectCsvRows(
                          directCsvContext!,
                          conn,
                          rows
                        )
                        if (progress.adaptive) {
                          progress.adaptive.reason = `direct csv streaming (${totalRowsWritten.toLocaleString()} rows written)`
                        }
                        throttled.emit(progress)
                      }
                    : undefined
                }
              )
            } catch (err) {
              const error = err instanceof Error ? err.message : 'Unknown fatal error'
              result = { totalRows: 0, error, chunkFiles: [], columns: [] }
              connProgress.status = 'error'
              connProgress.error = error
              connProgress.finished_at = new Date().toISOString()
            }

            if (!result.error) break
            // Cancellation: don't retry, don't sleep — finish immediately so
            // the worker pool can drain and the writer phase can start.
            if (result.cancelled || isCancelled()) break

            attempts++
            retryMap.set(conn.id, attempts)

            if (attempts > maxRetries) break

            const delay = 200 * Math.pow(2, attempts - 1)
            // Cancel-aware sleep: wake immediately if cancellation arrives.
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, delay)
              const poll = setInterval(() => {
                if (isCancelled()) {
                  clearTimeout(t)
                  clearInterval(poll)
                  resolve()
                }
              }, 50)
              setTimeout(() => clearInterval(poll), delay + 10)
            })
            if (isCancelled()) break

            connProgress.status = 'pending'
            connProgress.error = null
            connProgress.rows = aggregateRows
          }

          aggregateRows += result?.totalRows ?? 0
          if (result?.chunkFiles.length) {
            aggregateChunkFiles.push({ tag: step.tag, files: result.chunkFiles })
          }
          aggregateBucketMeta.push({
            tag: step.tag,
            columns: result?.columns ?? [],
            error: result?.error ?? null,
            rows: result?.totalRows ?? 0
          })
          if (result?.error) {
            aggregateError = result.error
            break
          }
        }

        // Roll aggregate back up into the shape expected below (single result).
        const result: StreamingConnectionResult = {
          totalRows: aggregateRows,
          error: aggregateError,
          chunkFiles: aggregateChunkFiles.flatMap((x) => x.files),
          columns: aggregateBucketMeta[aggregateBucketMeta.length - 1]?.columns ?? []
        }
        // If we exited the plan because of a cancellation (no error and the
        // executor returned `cancelled: true`), keep the connection 'pending'
        // so it shows up in the retry list rather than counting as success.
        const wasCancelled = isCancelled() && !aggregateError && aggregateRows === 0
        if (!aggregateError && !wasCancelled) {
          connProgress.status = 'done'
          connProgress.rows = aggregateRows
          connProgress.finished_at = new Date().toISOString()

          // ── Auto-update job variables after a successful connection run ──
          // Only when no error and not cancelled. We skip failed connections
          // so they retry from their last safe checkpoint value.
          // For API destination, variable updates are deferred to the
          // onConnectionSuccess callback (fired after data is confirmed delivered).
          if (
            job.destination_type !== 'api' &&
            jobVarMeta.size > 0 &&
            aggregateChunkFiles.length > 0
          ) {
            for (const [varName, meta] of jobVarMeta) {
              if (!meta.autoUpdate || !meta.sourceColumn) continue
              // Collect all chunk files for this connection across all plan steps
              const connChunkFiles = aggregateChunkFiles.flatMap((x) => x.files)
              if (connChunkFiles.length === 0) continue
              try {
                let best: string | null = null
                const col = meta.sourceColumn
                for (const chunkFile of connChunkFiles) {
                  const rows = await readChunkFromFile(chunkFile)
                  for (const row of rows) {
                    const raw = row[col]
                    if (raw === null || raw === undefined) continue
                    const str = raw instanceof Date ? raw.toISOString() : String(raw)
                    if (best === null) {
                      best = str
                    } else if (meta.updateFn === 'max' && str > best) {
                      best = str
                    } else if (meta.updateFn === 'min' && str < best) {
                      best = str
                    } else if (meta.updateFn === 'last') {
                      best = str
                    }
                  }
                }
                if (best !== null) {
                  jobVariableRepository.upsertValue(meta.id, conn.id, best)
                  await mirrorJobVariableSetValue(meta.id, conn.id, best)
                  // Update the in-memory connVarMap so later plan steps (if any)
                  // within the same job run can see the updated value.
                  const updated = connVarMap.get(conn.id) ?? {}
                  updated[varName] = best
                  connVarMap.set(conn.id, updated)
                }
              } catch (varErr) {
                // Non-fatal — variable update failure should never abort the job
                console.warn(
                  `[job-executor] Failed to auto-update variable "${varName}" for connection ${conn.id}:`,
                  varErr
                )
              }
            }
          }
        } else if (wasCancelled) {
          connProgress.status = 'pending'
          connProgress.error = null
          connProgress.finished_at = new Date().toISOString()
        }

        if (directCsvContext) {
          if (result.error) {
            // For single-query direct-CSV mode there is exactly one bucket meta entry.
            const lastMeta = aggregateBucketMeta[aggregateBucketMeta.length - 1]
            const cols = lastMeta?.columns ?? []
            // Drop any partial file then replace it with a header + error row
            // file so users always get an artefact per connection.
            await resetDirectCsvConnection(directCsvContext, conn.id)
            try {
              await writeDirectCsvErrorFile(directCsvContext, conn, cols, result.error)
            } catch {
              // best-effort — do not fail the entire job over a diagnostic file
            }
          } else {
            await closeDirectCsvConnection(directCsvContext, conn.id)
          }
        }

        progress.total_rows += result.totalRows
        if (result.error) {
          progress.failed_connections++
        }
        for (const entry of aggregateChunkFiles) {
          if (entry.files.length > 0) {
            allChunkFiles.set(entry.tag, entry.files)
          }
        }
        for (const entry of aggregateBucketMeta) {
          allBucketMeta.set(entry.tag, {
            columns: entry.columns,
            error: entry.error,
            rows: entry.rows
          })
        }
        // Cancelled-mid-flight connections stay 'pending' and are NOT counted
        // as completed — that way the floating progress bar doesn't claim
        // false completion and the retry list picks them up.
        if (!wasCancelled) {
          progress.completed_connections++
        }

        updateAdaptiveState()
        throttled.emit(progress)
      }
    } finally {
      activeWorkers--
      updateAdaptiveState()
    }
  }

  const workerPromises: Promise<void>[] = []
  const launchWorker = (): void => {
    const slot = workerPromises.length
    workerPromises.push(startWorker(slot))
  }

  // Seed initial workers
  for (let i = 0; i < targetWorkers; i++) launchWorker()

  // Periodic scaling tick — runs concurrently with workers
  const scalingTimer = setInterval(() => {
    if (currentIndex >= connections.length) return
    const decision = brain.recommend(targetWorkers, workerBounds)
    if (decision.action === 'hold') return
    const prevTarget = targetWorkers
    targetWorkers = decision.recommended
    // Scale up → spawn additional workers up to the new target. Gate on the
    // ACTIVE worker count (not total ever-launched) so that scaling back up
    // after a scale-down actually spawns replacements.
    while (activeWorkers < targetWorkers && currentIndex < connections.length) {
      launchWorker()
    }
    if (targetWorkers !== prevTarget) {
      updateAdaptiveState()
      throttled.emit(progress)
    }
  }, 2000)
  scalingTimer.unref?.()

  try {
    await Promise.all(workerPromises)
  } finally {
    clearInterval(scalingTimer)
    unsubscribe()
    brain.stop()
  }

  // ── Write output ─────────────────────────────────────────────────────────
  const successfulConnections = progress.completed_connections - progress.failed_connections
  const directCsvFinalized = false

  // Emit output as long as we have any artefact to record. This includes the
  // all-failed case so users still get a header + error row file per
  // connection (matches the Excel "empty sheet on failure" behaviour).
  const hasAnyOutput = successfulConnections > 0 || allChunkFiles.size > 0 || allBucketMeta.size > 0
  // For pure-API destinations there is nothing useful to send when no rows
  // were collected, so keep the original gate there.
  const shouldWriteOutput =
    job.destination_type === 'api' ? successfulConnections > 0 : hasAnyOutput

  if (
    progress.status === 'running' &&
    shouldWriteOutput &&
    (job.destination_type || isExcelDestination) &&
    effectiveDestinationConfig
  ) {
    try {
      if (isExcelDestination) {
        const destPath = effectiveDestinationConfig as string
        // Excel destination: always produce an Excel workbook regardless of
        // dataset size. Sheets are split via `_part1`, `_part2`, … rollovers
        // when a single connection exceeds the per-sheet row threshold.
        if (progress.adaptive) {
          progress.adaptive.output_format = 'excel-stream'
          progress.adaptive.output_reason = 'excel destination — streaming workbook'
        }

        const actualPath =
          job.excel_combine_sheets && !isMultiQuery
            ? await writeStreamingExcelCombined(
                destPath,
                job.operation,
                job.name,
                progress,
                connections,
                allChunkFiles,
                job.summary_extra_columns ?? [],
                job.modify_dates !== false,
                {
                  templatePath: await resolveMachineLocalTemplatePath(job.template_path, job.name),
                  templateMode: job.template_mode
                }
              )
            : await writeStreamingExcel(
                destPath,
                job.operation,
                job.name,
                progress,
                connections,
                allChunkFiles,
                {
                  templatePath: await resolveMachineLocalTemplatePath(job.template_path, job.name),
                  templateMode: job.template_mode
                },
                isMultiQuery ? (job.sql_query_names ?? []) : [],
                allBucketMeta,
                job.modify_dates !== false,
                job.summary_extra_columns ?? []
              )

        progress.output_path = actualPath
      } else if (job.destination_type === 'api') {
        await sendToApiStreaming(
          effectiveDestinationConfig as string,
          connections,
          allChunkFiles,
          // Per-connection success callback: update variables only after data
          // has actually been delivered to the API endpoint.
          jobVarMeta.size > 0
            ? async (connId: number) => {
                const conn = connections.find((c) => c.id === connId)
                if (!conn) return
                const connChunkFiles: string[] = []
                for (const [tag, files] of allChunkFiles) {
                  const { connId: tid } = parseChunkTag(tag)
                  if (tid === connId) connChunkFiles.push(...files)
                }
                if (connChunkFiles.length === 0) return
                for (const [varName, meta] of jobVarMeta) {
                  if (!meta.autoUpdate || !meta.sourceColumn) continue
                  try {
                    let best: string | null = null
                    const col = meta.sourceColumn
                    for (const chunkFile of connChunkFiles) {
                      const rows = await readChunkFromFile(chunkFile)
                      for (const row of rows) {
                        const raw = row[col]
                        if (raw === null || raw === undefined) continue
                        const str = raw instanceof Date ? raw.toISOString() : String(raw)
                        if (best === null) best = str
                        else if (meta.updateFn === 'max' && str > best) best = str
                        else if (meta.updateFn === 'min' && str < best) best = str
                        else if (meta.updateFn === 'last') best = str
                      }
                    }
                    if (best !== null) {
                      jobVariableRepository.upsertValue(meta.id, connId, best)
                      await mirrorJobVariableSetValue(meta.id, connId, best)
                      const updated = connVarMap.get(connId) ?? {}
                      updated[varName] = best
                      connVarMap.set(connId, updated)
                    }
                  } catch (varErr) {
                    console.warn(
                      `[job-executor] API: Failed to update variable "${varName}" for connection ${connId}:`,
                      varErr
                    )
                  }
                }
              }
            : undefined
        )
      } else if (job.destination_type === 'google_sheets') {
        if (progress.adaptive) {
          progress.adaptive.reason = 'writing google sheets output'
          progress.adaptive.output_progress_pct = 0
          progress.adaptive.output_progress_label = 'Preparing Google Sheets tabs'
          throttled.emit(progress)
        }
        const buckets = listOutputBuckets(
          connections,
          allChunkFiles,
          isMultiQuery ? (job.sql_query_names ?? []) : [],
          allBucketMeta
        )
        const googleSheetBuckets: GsheetBucket[] = buckets.map((bucket) => ({
          label: bucket.label,
          columns: bucket.columns,
          error: bucket.error,
          chunkFiles: bucket.chunkFiles,
          connectionId: bucket.connection?.id ?? null,
          rowCount: bucket.rows
        }))
        const shouldCreateCombinedSheet = job.excel_combine_sheets && !isMultiQuery
        const reservedGoogleSheetTabs = shouldCreateCombinedSheet
          ? ['Data', 'Summary']
          : ['Summary']
        const googleSheetBucketTargets = buildGoogleSheetBucketTargets(
          googleSheetBuckets,
          reservedGoogleSheetTabs
        )
        const googleSheetSummaryRows = buildGoogleSheetsSummaryRows(
          job.name,
          progress,
          connections,
          googleSheetBucketTargets,
          job.summary_extra_columns ?? []
        )
        const googleSheetTotalWriteRows = estimateGoogleSheetTotalWriteRows({
          buckets: googleSheetBuckets,
          combineSheets: shouldCreateCombinedSheet,
          summaryRows: googleSheetSummaryRows
        })
        const googleSheetWriteProgress = new Map<
          string,
          { rowsWritten: number; totalRowsForBucket: number }
        >()
        const sheetUrl = await writeToGoogleSheets({
          configJson: effectiveDestinationConfig as string,
          operation: (job.operation as 'append' | 'replace' | null) ?? null,
          buckets: googleSheetBuckets,
          readChunk: readChunkFromFile,
          combineSheets: shouldCreateCombinedSheet,
          jobProgress: progress,
          summaryRows: googleSheetSummaryRows,
          onProgress: ({ bucket, rowsWritten, totalRowsForBucket }) => {
            googleSheetWriteProgress.set(bucket, { rowsWritten, totalRowsForBucket })
            const totalWritten = Array.from(googleSheetWriteProgress.values()).reduce(
              (sum, entry) => sum + Math.min(entry.rowsWritten, entry.totalRowsForBucket),
              0
            )
            const pct =
              googleSheetTotalWriteRows > 0
                ? Math.min(100, Math.round((totalWritten / googleSheetTotalWriteRows) * 100))
                : 0

            if (progress.adaptive) {
              progress.adaptive.reason = `gsheet ${pct}% (${totalWritten.toLocaleString()}/${googleSheetTotalWriteRows.toLocaleString()} rows)`
              progress.adaptive.output_progress_pct = pct
              progress.adaptive.output_progress_label = `Writing Google Sheets: ${bucket}`
            }
            throttled.emit(progress)
          }
        })
        progress.output_path = sheetUrl
        if (progress.adaptive) {
          progress.adaptive.reason = 'google sheets output complete'
          progress.adaptive.output_progress_pct = 100
          progress.adaptive.output_progress_label = 'Google Sheets complete'
        }
      }
    } catch (err) {
      // Cancellation no longer interrupts the writer mid-flight (writers
      // ignore the cancel flag and finish writing whatever data was already
      // streamed). Anything caught here is a real write failure.
      const errMsg = err instanceof Error ? err.message : 'Failed to write output'
      progress.error = errMsg
      progress.status = 'failed'
    }
  }

  if (directCsvContext && !directCsvFinalized) {
    await disposeDirectCsvContext(directCsvContext)
  }

  // Finalize
  if (progress.status === 'running') {
    // Cancellation is treated as a successful early-exit: the user clicked
    // Cancel deliberately, the writer completed with the data we managed to
    // collect, and we do NOT want a red "failed" indicator. Status flips to
    // 'failed' only when real connection errors occurred.
    if (progress.failed_connections > 0 && successfulConnections === 0) {
      progress.status = 'failed'
      progress.error = progress.error ?? 'No connections were successful for this job run'
    } else {
      progress.status = 'success'
    }
  }

  progress.finished_at = new Date().toISOString()

  // Connections that errored OR never ran (cancelled before reaching them)
  // are eligible for a one-click retry on the jobs list page.
  const failedOrPendingIds = progress.connections
    .filter((c) => c.status === 'error' || c.status === 'pending')
    .map((c) => c.connection_id)

  // Build per-connection error map for detailed error log
  const connectionErrors = progress.connections
    .filter((c) => c.status === 'error' && c.error)
    .map((c) => ({ id: c.connection_id, name: c.connection_name, error: c.error! }))

  const dbStatus = progress.status
  jobRepository.update(jobId, {
    status: dbStatus,
    last_run_at: progress.finished_at,
    last_error:
      progress.error ??
      (progress.failed_connections > 0
        ? `${progress.failed_connections}/${progress.total_connections} connection(s) failed`
        : null),
    last_failed_connection_ids: failedOrPendingIds,
    last_connection_errors: connectionErrors
  } as Partial<JobRow>)

  throttled.flush(progress)
  runningJobs.delete(jobId)
  cancelledJobs.delete(jobId)
  jobRetries.delete(jobId)
  clearJobAbortHandle(jobId)

  // Cleanup temp files
  await cleanupTempDir(jobId)

  return progress
}
