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
import { settingsRepo } from '../../db/repositories/settings.repository'
import { storeRepository } from '../../db/repositories/store.repository'
import { getAdaptiveBrain, type HealthSnapshot } from './adaptive-brain'
import { decideOutputFormat } from './output-decision'
import { runActionJob } from './action-executor'
import { formatUtcToIst } from '../../utils/format-date'
import { writeToGoogleSheets } from './gsheet-writer'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max rows to buffer per connection before flushing to disk */
const CHUNK_SIZE = 5000
/** Abort a connection if it exceeds this many rows (safety valve) */
const MAX_ROWS_PER_CONNECTION = 20_000_000
/** Append mode on huge datasets is memory-heavy with XLSX merge; switch to fresh file above this */
const APPEND_SAFE_ROW_LIMIT = 200_000

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
  // Reflect cancellation in the live snapshot so the UI updates without
  // waiting for the next throttled emit cycle.
  const live = runningJobs.get(jobId)
  if (live && live.status !== 'success' && live.status !== 'failed') {
    live.status = 'cancelled'
    live.error = live.error ?? 'Job cancelled by user'
  }
  return true
}

// ─── Emit helper ──────────────────────────────────────────────────────────────

/**
 * Returns Desktop/<AppName>/ as the fallback output base directory when the
 * configured destination path is inaccessible (e.g. a mapped network drive or
 * Windows drive letter that doesn't exist on this machine).
 */
function appDesktopBaseDir(): string {
  return path.join(app.getPath('desktop'), app.getName())
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
  connProgress.status = 'connecting'
  connProgress.started_at = new Date().toISOString()

  let pool: mssql.ConnectionPool | null = null
  const tmpDir = getTempDir(jobId)
  const chunkFiles: string[] = []

  try {
    const connected = await connectUsingBestIp(conn, queryTimeoutSec, queryTimeoutSec)
    pool = connected.pool
    hooks?.abortHandle?.pools.add(pool)
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Connection failed'
    connProgress.status = 'error'
    connProgress.error = error
    connProgress.finished_at = new Date().toISOString()
    return { totalRows: 0, error, chunkFiles: [], columns: [] }
  }

  connProgress.status = 'querying'
  let totalRows = 0
  let currentBuffer: Record<string, unknown>[] = []
  let chunkIndex = 0
  const capturedColumns: string[] = []

  try {
    for (const query of queries) {
      if (!query.trim()) continue

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
            reject(err)
          })

          request.on('done', () => {
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

function styleDataSheet(sheet: ExcelJS.Worksheet): void {
  if (sheet.rowCount === 0) return
  applyHeaderStyle(sheet, 1, 'FF0EA5E9')
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (let i = 2; i <= sheet.rowCount; i++) {
    if (i % 2 === 0) {
      const row = sheet.getRow(i)
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      })
    }
  }

  sheet.columns.forEach((col) => {
    const headerText = col.header ? String(col.header) : ''
    let max = Math.max(12, headerText.length + 2)
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value
      const text = v === null || v === undefined ? '' : String(v)
      max = Math.max(max, Math.min(45, text.length + 2))
    })
    col.width = max
  })
}

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
 * or more sheets (with `_2`, `_3` … rollovers when the row threshold is hit).
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
      error: meta?.error ?? null
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
      error: meta.error
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
              error: meta?.error ?? null
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
            error: null
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

function nextRolloverSheetName(base: string, index: number, taken: Set<string>): string {
  const safe = sanitizeSheetName(base)
  if (index === 0) {
    // Reserve base in taken set and return as-is (unique within this job).
    const key = safe.toLowerCase()
    if (!taken.has(key)) {
      taken.add(key)
      return safe
    }
  }
  const stem = safe.slice(0, 28)
  let i = Math.max(2, index + 1)
  for (;;) {
    const candidate = `${stem}_${i}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
    i++
    if (i > 9999) {
      const fb = `${stem}_${Date.now() % 10_000}`
      taken.add(fb.toLowerCase())
      return fb
    }
  }
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
  allBucketMeta: Map<string, BucketMeta> = new Map()
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
    const fileName = `${sanitizeFileName(jobName)}_${fileTimestamp()}.xlsx`
    // Try the configured directory first; fall back to Desktop/<AppName>/ if inaccessible.
    const baseDir = fs.existsSync(destPath) ? destPath : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    filePath = path.join(baseDir, fileName)
    effectiveOp = 'replace'
  } else {
    // destPath is a file path — use its directory, falling back to Desktop/<AppName>/ if needed.
    const parsed = path.parse(destPath)
    const baseDir = fs.existsSync(parsed.dir) ? parsed.dir : appDesktopBaseDir()
    await fs.promises.mkdir(baseDir, { recursive: true })
    filePath = path.join(baseDir, parsed.base)
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

  if (!hasTemplate && effectiveOp === 'replace') {
    return await writeStreamingExcelReplace(
      filePath,
      jobName,
      progress,
      connections,
      allChunkFiles,
      queryNames,
      allBucketMeta
    )
  }

  const workbook = new ExcelJS.Workbook()

  if ((effectiveOp === 'append' || hasTemplate) && fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath)
  }

  const threshold = resolveSheetRowThreshold()
  // When writing INTO a user-supplied template, never apply our own styles to
  // data sheets — the template owns its formatting. Untouched sheets are
  // already left alone (the loop only iterates `buckets`).
  const styleData = !hasTemplate
  const taken = new Set<string>()
  for (const ws of workbook.worksheets) taken.add(ws.name.toLowerCase())
  taken.add('summary')

  const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
  for (const bucket of buckets) {
    const baseSheetName = sanitizeSheetName(bucket.label)
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
      const name = nextRolloverSheetName(baseSheetName, 0, taken)
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
      if (styleData) styleDataSheet(sheet)
      continue
    }

    for (const chunkFile of bucket.chunkFiles) {
      let firstRowSeen = false
      await streamChunkRows(chunkFile, (row) => {
        if (!headersSet) {
          headers = Object.keys(row)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          headersSet = true
          rowsInSheet = 1
        }
        firstRowSeen = true
        if (rowsInSheet >= threshold) {
          if (styleData) styleDataSheet(sheet)
          rolloverIndex++
          const nextName = nextRolloverSheetName(baseSheetName, rolloverIndex, taken)
          sheet = workbook.addWorksheet(nextName)
          sheet.columns = headers.map((col) => ({ header: col, key: col, width: 15 }))
          rowsInSheet = 1
        }
        sheet.addRow(row)
        rowsInSheet++
      })
      // Empty chunk files are skipped silently to keep the sheet clean.
      void firstRowSeen
    }

    if (styleData) styleDataSheet(sheet)
  }

  writeSummarySheet(workbook, jobName, progress, connections, queryNames, allBucketMeta)

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
  allBucketMeta: Map<string, BucketMeta> = new Map()
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

  const threshold = resolveSheetRowThreshold()
  const taken = new Set<string>()
  taken.add('summary')

  const buckets = listOutputBuckets(connections, allChunkFiles, queryNames, allBucketMeta)
  for (const bucket of buckets) {
    const baseSheetName = sanitizeSheetName(bucket.label)
    let rolloverIndex = 0
    let sheet = workbook.addWorksheet(nextRolloverSheetName(baseSheetName, 0, taken))

    let headers: string[] = []
    let hasHeader = false
    let rowsInSheet = 0

    const writeHeader = (): void => {
      const hr = sheet.addRow(headers)
      hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } }
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
          sheet = workbook.addWorksheet(nextRolloverSheetName(baseSheetName, rolloverIndex, taken))
          writeHeader()
        }
        const values = headers.map((key) => row[key] as ExcelJS.CellValue)
        sheet.addRow(values).commit()
        rowsInSheet++
      })
    }

    sheet.commit()
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

  const summaryHeaders = [
    'Connection',
    'Sheet Name',
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
}

// ─── Summary sheet ────────────────────────────────────────────────────────────

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  jobName: string,
  progress: JobProgress,
  connections: ConnectionRow[] = [],
  queryNames: string[] = [],
  allBucketMeta: Map<string, BucketMeta> = new Map()
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

  // Sheet Name is now shown in BOTH single- and multi-query mode so users can
  // always trace a row back to the worksheet that holds its data.
  sheet.columns = [
    { header: 'Connection', key: 'connection_name', width: 28 },
    { header: 'Sheet Name', key: 'sheet_name', width: 22 },
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
  allChunkFiles: Map<string, string[]>
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
    try {
      headers = { ...headers, ...JSON.parse(config.headers) }
    } catch {
      // Invalid headers JSON
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
    throw new Error(
      `API ${method} ${url} failed for "${conn.name}": ${res.status} ${res.statusText}`
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
  const effectiveDestinationConfig = job.destination_config

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

  let preflightDecision: ReturnType<typeof decideOutputFormat> | null = null
  let preflightEstimatedRowsPerConn: number | null = null
  let directCsvContext: DirectCsvContext | null = null

  if (
    job.destination_type === 'excel' &&
    typeof effectiveDestinationConfig === 'string' &&
    !isMultiQuery
  ) {
    preflightEstimatedRowsPerConn = await estimateRowsForSampleConnection(
      connections[0],
      queries,
      jobTimeoutSec
    )

    if (preflightEstimatedRowsPerConn !== null) {
      const estimatedTotalRows = preflightEstimatedRowsPerConn * connections.length
      preflightDecision = decideOutputFormat({
        totalRows: estimatedTotalRows,
        connectionCount: connections.length,
        maxParallel: configuredMax,
        memoryUsage: 0,
        preferred: 'auto'
      })

      if (preflightDecision.format === 'csv') {
        try {
          directCsvContext = await createDirectCsvContext(effectiveDestinationConfig, job.name)
        } catch {
          // Fall back to chunk-file path if preflight CSV context setup fails.
          directCsvContext = null
        }
      }
    }
  }

  // ── Adaptive Brain wiring ───────────────────────────────────────────────
  const brain = getAdaptiveBrain()
  brain.start()

  let activeWorkers = 0
  let targetWorkers = configuredMax
  const workerBounds = { min: 1, max: configuredMax }

  const getSnapshot = (): HealthSnapshot | null => brain.getSnapshot()
  const isBackpressured = (): boolean => getSnapshot()?.backpressure === true
  const isCancelled = (): boolean => cancelledJobs.has(jobId)

  // Initial (empty) adaptive state — refined on first snapshot
  const initialFormatDecision =
    preflightDecision ??
    decideOutputFormat({
      totalRows: 0,
      connectionCount: connections.length,
      maxParallel: configuredMax,
      memoryUsage: 0,
      preferred: job.destination_type === 'excel' ? 'auto' : 'auto'
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
    output_format: job.destination_type === 'excel' ? initialFormatDecision.format : null,
    output_reason:
      job.destination_type === 'excel'
        ? preflightEstimatedRowsPerConn !== null
          ? `preflight estimate: ${preflightEstimatedRowsPerConn.toLocaleString()} rows/connection, ${initialFormatDecision.reason}`
          : initialFormatDecision.reason
        : null
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
      output_reason: progress.adaptive?.output_reason ?? null
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

        // Multi-query jobs produce one output bucket (sheet / CSV) per query
        // per connection. Single-query jobs use one bucket per connection.
        const plan = isMultiQuery
          ? queries.map((q, qIdx) => ({
              queries: [q],
              tag: chunkTagFor(conn.id, qIdx),
              queryIdx: qIdx as number | null
            }))
          : [{ queries, tag: chunkTagFor(conn.id, null), queryIdx: null as number | null }]

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

            attempts++
            retryMap.set(conn.id, attempts)

            if (attempts > maxRetries) break

            const delay = 200 * Math.pow(2, attempts - 1)
            await new Promise((resolve) => setTimeout(resolve, delay))

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
        if (!aggregateError) {
          connProgress.status = 'done'
          connProgress.rows = aggregateRows
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
        progress.completed_connections++

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
  let directCsvFinalized = false

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
    job.destination_type &&
    effectiveDestinationConfig
  ) {
    try {
      if (job.destination_type === 'excel') {
        const destPath = effectiveDestinationConfig as string
        let actualPath: string

        if (directCsvContext) {
          if (progress.adaptive) {
            progress.adaptive.output_format = 'csv'
            progress.adaptive.output_reason =
              progress.adaptive.output_reason ?? 'preflight selected direct csv streaming'
            progress.adaptive.reason = 'finalizing direct csv output'
            throttled.emit(progress)
          }

          actualPath = await finalizeDirectCsvOutput(directCsvContext, progress)
          directCsvFinalized = true

          if (progress.adaptive) {
            progress.adaptive.reason = 'csv output complete'
          }
        } else {
          // Pick format adaptively based on final dataset + current system state
          const snap = getSnapshot()
          const decision = decideOutputFormat({
            totalRows: progress.total_rows,
            connectionCount: connections.length,
            maxParallel: configuredMax,
            memoryUsage: snap?.memory ?? 0,
            preferred: 'auto'
          })

          if (progress.adaptive) {
            progress.adaptive.output_format = decision.format
            progress.adaptive.output_reason = decision.reason
          }

          if (decision.format === 'csv') {
            if (progress.adaptive) {
              progress.adaptive.reason = 'writing csv output (0%)'
              throttled.emit(progress)
            }

            actualPath = await writeStreamingCsv(
              destPath,
              job.name,
              progress,
              connections,
              allChunkFiles,
              {
                isCancelled,
                onChunkWritten: (_chunkRows, totalRowsWritten, targetRows) => {
                  if (progress.adaptive) {
                    if (targetRows > 0) {
                      const pct = Math.min(100, Math.round((totalRowsWritten / targetRows) * 100))
                      progress.adaptive.reason = `writing csv output (${pct}%)`
                    } else {
                      progress.adaptive.reason = `writing csv output (${totalRowsWritten} rows)`
                    }
                  }
                  throttled.emit(progress)
                }
              },
              isMultiQuery ? (job.sql_query_names ?? []) : [],
              allBucketMeta
            )

            if (progress.adaptive) {
              progress.adaptive.reason = 'csv output complete'
            }
          } else {
            // excel / excel-stream — writeStreamingExcel already streams when needed
            actualPath = await writeStreamingExcel(
              destPath,
              job.operation,
              job.name,
              progress,
              connections,
              allChunkFiles,
              {
                templatePath: job.template_path,
                templateMode: job.template_mode
              },
              isMultiQuery ? (job.sql_query_names ?? []) : [],
              allBucketMeta
            )
          }
        }

        progress.output_path = actualPath
      } else if (job.destination_type === 'api') {
        await sendToApiStreaming(effectiveDestinationConfig as string, connections, allChunkFiles)
      } else if (job.destination_type === 'google_sheets') {
        if (progress.adaptive) {
          progress.adaptive.reason = 'writing google sheets output'
          throttled.emit(progress)
        }
        const buckets = listOutputBuckets(
          connections,
          allChunkFiles,
          isMultiQuery ? (job.sql_query_names ?? []) : [],
          allBucketMeta
        )
        const sheetUrl = await writeToGoogleSheets({
          configJson: effectiveDestinationConfig as string,
          operation: (job.operation as 'append' | 'replace' | null) ?? null,
          buckets: buckets.map((b) => ({
            label: b.label,
            columns: b.columns,
            error: b.error,
            chunkFiles: b.chunkFiles
          })),
          readChunk: readChunkFromFile,
          onProgress: ({ bucket, rowsWritten, totalRowsForBucket }) => {
            if (progress.adaptive) {
              const pct =
                totalRowsForBucket > 0
                  ? Math.min(100, Math.round((rowsWritten / totalRowsForBucket) * 100))
                  : 0
              progress.adaptive.reason = `gsheet "${bucket}" ${pct}% (${rowsWritten.toLocaleString()} rows)`
            }
            throttled.emit(progress)
          }
        })
        progress.output_path = sheetUrl
        if (progress.adaptive) progress.adaptive.reason = 'google sheets output complete'
      }
    } catch (err) {
      if (cancelledJobs.has(jobId)) {
        progress.status = 'cancelled'
        progress.error = 'Job cancelled by user'
      } else {
        const errMsg = err instanceof Error ? err.message : 'Failed to write output'
        progress.error = errMsg
        progress.status = 'failed'
      }
    }
  }

  if (directCsvContext && !directCsvFinalized) {
    await disposeDirectCsvContext(directCsvContext)
  }

  // Finalize
  if (progress.status === 'running') {
    if (cancelledJobs.has(jobId)) {
      progress.status = 'cancelled'
      progress.error = 'Job cancelled by user'
    } else if (successfulConnections === 0) {
      progress.status = 'failed'
      progress.error = 'No connections were successful for this job run'
    } else {
      progress.status = 'success'
    }
  }
  progress.finished_at = new Date().toISOString()

  const dbStatus = progress.status === 'cancelled' ? 'failed' : progress.status
  jobRepository.update(jobId, {
    status: dbStatus,
    last_run_at: progress.finished_at,
    last_error:
      progress.error ??
      (progress.failed_connections > 0
        ? `${progress.failed_connections}/${progress.total_connections} connection(s) failed`
        : null)
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
