/**
 * Google Sheets output writer.
 *
 * Production concerns handled:
 *   - Service-account auth (JSON credentials supplied via destination_config).
 *   - Batched `values.append` calls (default 5,000 rows per request) so we
 *     stay under the 10MB request body cap and avoid timeouts on huge sets.
 *   - Exponential-backoff retry on rate-limit / transient errors (429, 5xx).
 *   - Per-bucket sheets: one tab per (connection, queryIdx) — same naming
 *     scheme used for Excel / CSV outputs (query_name for multi-query, store
 *     code for single-query).
 *   - Append OR replace operation: replace clears the tab before writing.
 *   - Header + error row when a bucket has no rows but the query failed,
 *     mirroring the CSV / Excel error-file behaviour.
 */
import fs from 'fs'
import { google, type sheets_v4 } from 'googleapis'
import type { JWT } from 'google-auth-library'
import type { JobProgress } from '@shared/index'

/** Max values batch sent in a single `values.append` request. */
const ROWS_PER_BATCH = 5_000

/** Largest payload allowed before forcing an extra split. */
const MAX_VALUES_PER_REQUEST = 10_000

/** Base delay (ms) for exponential backoff on retryable errors. */
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_ATTEMPTS = 6

const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

export interface GoogleSheetsConfig {
  /** Spreadsheet URL or raw spreadsheet ID. */
  sheet_id?: string
  spreadsheetUrl?: string
  spreadsheetId?: string
  /** Service-account JSON credentials, either parsed or stringified. */
  service_account_json?: string | Record<string, unknown>
  credentials_json?: string | Record<string, unknown>
  /** Alias used by the renderer form. */
  credentials?: string | Record<string, unknown>
}

export interface GsheetBucket {
  /** Display label of the destination tab (matches Excel/CSV naming). */
  label: string
  /** Captured query column names. May be empty when the query failed early. */
  columns: string[]
  /** Per-bucket error message (used to emit a header + error row when no data). */
  error: string | null
  /** Local JSON chunk files containing the rows for this bucket. */
  chunkFiles: string[]
}

export interface WriteToGoogleSheetsOptions {
  configJson: string
  operation: 'append' | 'replace' | null
  buckets: GsheetBucket[]
  /** Reads a chunk file and returns its array of row objects. */
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
  /** Optional progress reporter — fires after each successful append batch. */
  onProgress?: (info: { bucket: string; rowsWritten: number; totalRowsForBucket: number }) => void
  /**
   * When true, write a combined "Data" tab (Sheet Name as first column, all
   * connections merged) and a "Summary" tab — same behaviour as Excel combine mode.
   */
  combineSheets?: boolean
  /** Job progress snapshot used to populate the Summary tab. */
  jobProgress?: JobProgress
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function writeToGoogleSheets(opts: WriteToGoogleSheetsOptions): Promise<string> {
  const config = parseConfig(opts.configJson)
  const spreadsheetId = resolveSpreadsheetId(config)
  const credentials = loadServiceAccountCredentials(config)

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SHEETS_SCOPES
  })
  await auth.authorize()

  const sheets = google.sheets({ version: 'v4', auth: auth as JWT })

  // Snapshot existing tab names + IDs so we can create / clear targets.
  const meta = await callWithRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
  )
  const existingTabs = new Map<string, number>()
  for (const s of meta.data.sheets ?? []) {
    const title = s.properties?.title
    const id = s.properties?.sheetId
    if (title && typeof id === 'number') existingTabs.set(title, id)
  }

  // Sanitize bucket labels into unique tab names and pre-create / clear them.
  const taken = new Set<string>(existingTabs.keys())
  const targets: Array<{ bucket: GsheetBucket; tabName: string }> = []

  const tabsToCreate: Array<{ title: string }> = []
  const tabsToClear: string[] = []

  for (const bucket of opts.buckets) {
    // If a tab with this label already exists (case-insensitive), reuse its exact
    // name so we don't accumulate _2/_3/_4 suffixes on repeated runs.
    const sanitized =
      (bucket.label || 'Sheet1')
        .replace(/[:/\\?*[\]]/g, '_')
        .slice(0, 100)
        .trim() || 'Sheet1'
    const existingMatch = [...existingTabs.keys()].find(
      (t) => t.toLowerCase() === sanitized.toLowerCase()
    )
    const tabName = existingMatch ?? uniqueTabName(bucket.label, taken)
    if (existingMatch && !taken.has(existingMatch)) taken.add(existingMatch)
    targets.push({ bucket, tabName })

    if (!existingTabs.has(tabName)) {
      tabsToCreate.push({ title: tabName })
    } else if (opts.operation === 'replace' || opts.operation == null) {
      tabsToClear.push(tabName)
    }
  }

  // tabSheetIds: name → sheetId (needed to resize grid before writing)
  // newlyCreatedTabs: only tabs we just created — existing tabs keep their current grid size
  const tabSheetIds = new Map<string, number>(existingTabs)
  const newlyCreatedTabNames = new Set<string>()

  if (tabsToCreate.length > 0) {
    const createResp = await callWithRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: tabsToCreate.map((t) => ({
            addSheet: { properties: { title: t.title } }
          }))
        }
      })
    )
    // Capture sheetIds of newly created tabs so we can resize them.
    for (let i = 0; i < tabsToCreate.length; i++) {
      const props = createResp.data.replies?.[i]?.addSheet?.properties
      if (props?.title && typeof props.sheetId === 'number') {
        tabSheetIds.set(props.title, props.sheetId)
        newlyCreatedTabNames.add(props.title)
      }
    }
  }

  // Resize ALL target tabs to their actual needed column count.
  // - New tabs default to 26 cols → too few for wide queries.
  // - Existing cleared tabs may also still have only 26 cols.
  // - We use bucket.columns.length (always populated) so we never over-allocate.
  //   e.g. 18 tabs × 50 cols × 1000 rows = 900K cells — well under 10M limit.
  const resizeRequests = targets
    .map(({ tabName, bucket }) => {
      const sheetId = tabSheetIds.get(tabName)
      if (sheetId == null) return null
      const colsNeeded = Math.max(bucket.columns.length + 2, 26)
      return {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { columnCount: colsNeeded } },
          fields: 'gridProperties.columnCount'
        }
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  if (resizeRequests.length > 0) {
    await callWithRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: resizeRequests }
      })
    )
  }

  if (tabsToClear.length > 0) {
    // Clear in chunks of 100 ranges per request to stay well under quota.
    for (let i = 0; i < tabsToClear.length; i += 100) {
      const slice = tabsToClear.slice(i, i + 100)
      await callWithRetry(() =>
        sheets.spreadsheets.values.batchClear({
          spreadsheetId,
          requestBody: { ranges: slice }
        })
      )
    }
  }

  // Stream rows into each target tab.
  for (const { bucket, tabName } of targets) {
    await writeBucketToTab(sheets, spreadsheetId, tabName, bucket, opts)
  }

  // ── Combined "Data" tab ────────────────────────────────────────────────────
  // When combine mode is enabled, write a single tab that merges all buckets
  // with "Sheet Name" as the first column — mirrors Excel combine behaviour.
  if (opts.combineSheets && opts.buckets.length > 0) {
    const dataTabName = 'Data'
    // Clear or create the Data tab.
    if (existingTabs.has(dataTabName)) {
      await callWithRetry(() =>
        sheets.spreadsheets.values.batchClear({
          spreadsheetId,
          requestBody: { ranges: [dataTabName] }
        })
      )
    } else {
      await callWithRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: dataTabName } } }] }
        })
      )
    }

    let dataHeaders: string[] | null = null
    let dataPending: unknown[][] = []

    for (const bucket of opts.buckets) {
      if (bucket.chunkFiles.length === 0) continue
      const sheetLabel = bucket.label

      for (const chunkFile of bucket.chunkFiles) {
        const rows = await opts.readChunk(chunkFile)
        if (rows.length === 0) continue

        if (!dataHeaders) {
          dataHeaders = ['Sheet Name', ...Object.keys(rows[0])]
          dataPending.push(dataHeaders)
        }

        for (const row of rows) {
          const keys = dataHeaders.slice(1)
          dataPending.push([
            sheetLabel,
            ...keys.map((k) => normalizeCell((row as Record<string, unknown>)[k]))
          ])
          if (dataPending.length >= ROWS_PER_BATCH) {
            await appendBatch(sheets, spreadsheetId, dataTabName, dataPending)
            dataPending = []
          }
        }
      }
    }
    if (dataPending.length > 0) {
      await appendBatch(sheets, spreadsheetId, dataTabName, dataPending)
    }
  }

  // ── "Summary" tab ─────────────────────────────────────────────────────────
  // Always written when combineSheets is on (same as Excel combine mode).
  if (opts.combineSheets && opts.jobProgress) {
    const summaryTabName = 'Summary'
    if (existingTabs.has(summaryTabName)) {
      await callWithRetry(() =>
        sheets.spreadsheets.values.batchClear({
          spreadsheetId,
          requestBody: { ranges: [summaryTabName] }
        })
      )
    } else {
      await callWithRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: summaryTabName } } }] }
        })
      )
    }

    const p = opts.jobProgress
    const summaryRows: unknown[][] = [
      ['Job Name', p.job_name],
      ['Status', p.status],
      ['Total Connections', p.total_connections],
      ['Completed', p.completed_connections],
      ['Failed', p.failed_connections],
      ['Total Rows', p.total_rows],
      ['Started At', p.started_at],
      ['Finished At', p.finished_at ?? ''],
      ['Error', p.error ?? ''],
      [],
      ['Connection Name', 'Status', 'Rows', 'Started At', 'Finished At', 'Error']
    ]
    for (const c of p.connections) {
      summaryRows.push([
        c.connection_name,
        c.status,
        c.rows,
        c.started_at ?? '',
        c.finished_at ?? '',
        c.error ?? ''
      ])
    }
    await appendBatch(sheets, spreadsheetId, summaryTabName, summaryRows)
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

// ─── Per-bucket writer ───────────────────────────────────────────────────────

async function writeBucketToTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  bucket: GsheetBucket,
  opts: WriteToGoogleSheetsOptions
): Promise<void> {
  // Empty bucket → still emit a header (and an error row when applicable).
  if (bucket.chunkFiles.length === 0) {
    if (bucket.error) {
      const headers = bucket.columns.length > 0 ? [...bucket.columns, 'Error'] : ['Error']
      const errorRow =
        bucket.columns.length > 0 ? [...bucket.columns.map(() => ''), bucket.error] : [bucket.error]
      await appendBatch(sheets, spreadsheetId, tabName, [headers, errorRow])
    } else if (bucket.columns.length > 0) {
      await appendBatch(sheets, spreadsheetId, tabName, [bucket.columns])
    }
    return
  }

  let headers: string[] | null = null
  let pending: unknown[][] = []
  let rowsWritten = 0
  let totalRowsForBucket = 0

  // First pass: count total rows across all chunks for progress reporting.
  for (const f of bucket.chunkFiles) {
    const arr = await opts.readChunk(f)
    totalRowsForBucket += arr.length
  }

  for (const f of bucket.chunkFiles) {
    const rows = await opts.readChunk(f)
    if (rows.length === 0) continue

    if (!headers) {
      headers = Object.keys(rows[0])
      pending.push(headers)
    }

    for (const row of rows) {
      pending.push(headers.map((h) => normalizeCell((row as Record<string, unknown>)[h])))
      if (pending.length >= ROWS_PER_BATCH) {
        await appendBatch(sheets, spreadsheetId, tabName, pending)
        rowsWritten += pending.length
        pending = []
        opts.onProgress?.({ bucket: tabName, rowsWritten, totalRowsForBucket })
      }
    }
  }

  if (pending.length > 0) {
    await appendBatch(sheets, spreadsheetId, tabName, pending)
    rowsWritten += pending.length
    opts.onProgress?.({ bucket: tabName, rowsWritten, totalRowsForBucket })
  }
}

async function appendBatch(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  values: unknown[][]
): Promise<void> {
  if (values.length === 0) return

  // Defensive split: never send more than MAX_VALUES_PER_REQUEST rows in one call.
  for (let i = 0; i < values.length; i += MAX_VALUES_PER_REQUEST) {
    const slice = values.slice(i, i + MAX_VALUES_PER_REQUEST)
    await callWithRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: slice as (string | number | boolean)[][] }
      })
    )
  }
}

// ─── Retry helper ────────────────────────────────────────────────────────────

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRetryable(err)) throw err
      const delay = computeBackoff(err, attempt)
      await sleep(delay)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Google Sheets request failed after retries')
}

function isRetryable(err: unknown): boolean {
  const code = extractStatus(err)
  if (code == null) return false
  return code === 408 || code === 429 || (code >= 500 && code <= 599)
}

function extractStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err == null) return null
  // googleapis errors expose `code` (number) or `response.status`.
  const e = err as { code?: number | string; response?: { status?: number } }
  if (typeof e.code === 'number') return e.code
  if (typeof e.code === 'string') {
    const n = Number(e.code)
    if (Number.isFinite(n)) return n
  }
  if (e.response?.status != null) return e.response.status
  return null
}

function computeBackoff(err: unknown, attempt: number): number {
  // Honor explicit Retry-After when the API provides it.
  const retryAfter = extractRetryAfterMs(err)
  if (retryAfter != null) return retryAfter
  const exp = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(exp + jitter, 30_000)
}

function extractRetryAfterMs(err: unknown): number | null {
  if (typeof err !== 'object' || err == null) return null
  const e = err as { response?: { headers?: Record<string, string | string[]> } }
  const raw = e.response?.headers?.['retry-after']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.floor(seconds * 1000)
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseConfig(json: string): GoogleSheetsConfig {
  if (!json || !json.trim()) {
    throw new Error('Google Sheets destination config is missing.')
  }
  try {
    return JSON.parse(json) as GoogleSheetsConfig
  } catch {
    throw new Error('Google Sheets destination config is not valid JSON.')
  }
}

function resolveSpreadsheetId(config: GoogleSheetsConfig): string {
  const candidate = config.spreadsheetId ?? config.sheet_id ?? config.spreadsheetUrl ?? ''
  if (!candidate || typeof candidate !== 'string') {
    throw new Error('Google Sheets config is missing the spreadsheet id / URL.')
  }
  // Direct ID (no slashes).
  if (!candidate.includes('/')) return candidate
  const m = candidate.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  throw new Error(`Could not extract spreadsheet id from "${candidate}"`)
}

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
}

function loadServiceAccountCredentials(config: GoogleSheetsConfig): ServiceAccountCredentials {
  const raw = config.service_account_json ?? config.credentials_json ?? config.credentials
  if (!raw) {
    throw new Error('Google Sheets config is missing service_account_json credentials.')
  }

  let parsed: Record<string, unknown>
  if (typeof raw === 'string') {
    // Normalise: the textarea sometimes wraps the JSON in {{ … }} (double
    // curly braces). Strip them so we always get bare JSON.
    const stripped = raw.trim().replace(/^\{\{/, '{').replace(/\}\}$/, '}').trim()

    // Allow a path to a JSON key file as well as the inline JSON blob.
    if (stripped.startsWith('{')) {
      try {
        parsed = JSON.parse(stripped) as Record<string, unknown>
      } catch {
        throw new Error(
          'service_account_json is not valid JSON. Paste the full service-account key file contents.'
        )
      }
    } else if (fs.existsSync(raw.trim())) {
      try {
        parsed = JSON.parse(fs.readFileSync(raw.trim(), 'utf-8')) as Record<string, unknown>
      } catch {
        throw new Error(`Could not read service account JSON from ${raw.trim()}`)
      }
    } else {
      throw new Error('service_account_json must be a JSON blob or a path to an existing key file.')
    }
  } else {
    parsed = raw
  }

  const email = parsed.client_email
  let key = parsed.private_key

  // Detect common mistake: user pasted an OAuth2 web/installed client credentials
  // file instead of a Service Account key file.
  if (!email || !key) {
    if (parsed.web || parsed.installed) {
      throw new Error(
        'Wrong credential type: you pasted an OAuth2 client credentials file. ' +
          'Google Sheets requires a Service Account key file. ' +
          'Go to Google Cloud Console → IAM & Admin → Service Accounts → ' +
          'create/select a service account → Keys → Add Key → JSON. ' +
          'Paste the downloaded JSON (it will contain "client_email" and "private_key").'
      )
    }
    const missing: string[] = []
    if (!email) missing.push('client_email')
    if (!key) missing.push('private_key')
    throw new Error(
      `service_account_json is missing required fields: ${missing.join(', ')}. ` +
        'Make sure you are pasting a Service Account key JSON file from Google Cloud Console.'
    )
  }
  if (typeof email !== 'string' || typeof key !== 'string') {
    throw new Error('service_account_json is missing required fields (client_email, private_key).')
  }
  // PEM keys often arrive with literal "\n" — restore real newlines.
  const privateKey = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
  return { client_email: email, private_key: privateKey }
}

function uniqueTabName(rawLabel: string, taken: Set<string>): string {
  // Google Sheets allows sheet names up to 100 chars. Disallowed: : / \ ? * [ ]
  const cleaned =
    (rawLabel || 'Sheet1')
      .replace(/[:/\\?*[\]]/g, '_')
      .slice(0, 100)
      .trim() || 'Sheet1'
  if (!taken.has(cleaned)) {
    taken.add(cleaned)
    return cleaned
  }
  const stem = cleaned.slice(0, 96)
  for (let i = 2; i < 9999; i++) {
    const candidate = `${stem}_${i}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  const fallback = `${stem}_${Date.now() % 10_000}`
  taken.add(fallback)
  return fallback
}

function normalizeCell(value: unknown): string | number | boolean {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
