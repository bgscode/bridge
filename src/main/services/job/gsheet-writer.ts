import { google, type sheets_v4 } from 'googleapis'
import type { JWT } from 'google-auth-library'
import type { JobProgress } from '@shared/index'

const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const WRITE_DELAY_MS = 1200
const MAX_ROWS_PER_WRITE = 10000
const MAX_CELLS_PER_WRITE = 250000
const MAX_RANGES_PER_BATCH_WRITE = 10
const MAX_CELLS_PER_BATCH_WRITE = 300000
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_ATTEMPTS = 8
const MIN_SHEET_ROWS = 1
const MIN_SHEET_COLUMNS = 1
const COMBINED_DATA_TAB_NAME = 'Data'
const SUMMARY_TAB_NAME = 'Summary'
const MESSAGE_COLUMN_NAME = 'Message'
const NO_DATA_MESSAGE = 'No rows found'

let lastWriteCompletedAt = 0
let writeQueue: Promise<void> = Promise.resolve()

export interface GoogleSheetsConfig {
  sheet_id?: string
  spreadsheetUrl?: string
  spreadsheetId?: string
  service_account_json?: string | Record<string, unknown>
  credentials_json?: string | Record<string, unknown>
  credentials?: string | Record<string, unknown>
}

export interface GsheetBucket {
  label: string
  columns: string[]
  error: string | null
  chunkFiles: string[]
  connectionId?: number | null
  rowCount?: number
}

export interface WriteToGoogleSheetsOptions {
  configJson: string
  operation: 'append' | 'replace' | null
  buckets: GsheetBucket[]
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
  onProgress?: (info: { bucket: string; rowsWritten: number; totalRowsForBucket: number }) => void
  combineSheets?: boolean
  jobProgress?: JobProgress
  summaryRows?: unknown[][] | null
}

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
}

interface SheetState {
  sheetId: number
  title: string
  rowCount: number
  columnCount: number
}

interface BucketPlan {
  headers: string[]
  totalDataRows: number
  maxColumnCount: number
  previewFilePath: string | null
  previewRows: Record<string, unknown>[] | null
  messageRow: SheetRow | null
}

interface WriteChunk {
  rows: SheetRow[]
  maxWidth: number
}

interface PendingValueWrite {
  tabName: string
  targetRange: string
  rows: SheetRow[]
  rowCount: number
  maxWidth: number
  cellCount: number
}

interface ValueWriteBuffer {
  writes: PendingValueWrite[]
  totalCells: number
}

export interface GoogleSheetBucketTarget {
  bucket: GsheetBucket
  tabName: string
}

type SheetCell = string | number | boolean
type SheetRow = SheetCell[]

export function buildGoogleSheetBucketTargets(
  buckets: GsheetBucket[],
  reservedTabNames: string[] = []
): GoogleSheetBucketTarget[] {
  const taken = new Set(reservedTabNames.map((name) => name.toLowerCase()))
  const counts = new Map<string, number>()

  return buckets.map((bucket) => {
    const base = sanitizeSheetName(bucket.label)
    const baseKey = base.toLowerCase()
    let index = (counts.get(baseKey) ?? 0) + 1
    let candidate = index === 1 ? base : appendSheetSuffix(base, index)

    while (taken.has(candidate.toLowerCase())) {
      index += 1
      candidate = index === 1 ? base : appendSheetSuffix(base, index)
    }

    counts.set(baseKey, index)
    taken.add(candidate.toLowerCase())

    return {
      bucket,
      tabName: candidate
    }
  })
}

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

  const sheets = google.sheets({
    version: 'v4',
    auth: auth as JWT
  })
  const writeBuffer = createValueWriteBuffer()

  let sheetStates = await getSheetStates(sheets, spreadsheetId)
  const reservedTabs: string[] = []

  if (opts.combineSheets) {
    reservedTabs.push(COMBINED_DATA_TAB_NAME)
  }

  if ((opts.summaryRows?.length ?? 0) > 0) {
    reservedTabs.push(SUMMARY_TAB_NAME)
  }

  const bucketTargets = buildGoogleSheetBucketTargets(opts.buckets, reservedTabs)

  sheetStates = await ensureTabsExist(sheets, spreadsheetId, sheetStates, [
    ...bucketTargets.map((target) => target.tabName),
    ...reservedTabs
  ])

  for (const bucketTarget of bucketTargets) {
    const sheetState = sheetStates.get(bucketTarget.tabName)

    if (!sheetState) {
      throw new Error(`Google Sheets tab not found after creation: ${bucketTarget.tabName}`)
    }

    const updatedState = await writeBucketToSheet({
      sheets,
      spreadsheetId,
      writeBuffer,
      sheetState,
      bucketTarget,
      operation: opts.operation ?? 'replace',
      readChunk: opts.readChunk,
      onProgress: opts.onProgress
    })

    sheetStates.set(bucketTarget.tabName, updatedState)
  }

  if (opts.combineSheets) {
    const dataSheetState = sheetStates.get(COMBINED_DATA_TAB_NAME)

    if (!dataSheetState) {
      throw new Error(`Google Sheets tab not found after creation: ${COMBINED_DATA_TAB_NAME}`)
    }

    const updatedDataState = await writeCombinedDataSheet({
      sheets,
      spreadsheetId,
      writeBuffer,
      sheetState: dataSheetState,
      bucketTargets,
      operation: opts.operation ?? 'replace',
      readChunk: opts.readChunk,
      onProgress: opts.onProgress
    })

    sheetStates.set(COMBINED_DATA_TAB_NAME, updatedDataState)
  }

  if ((opts.summaryRows?.length ?? 0) > 0) {
    const summarySheetState = sheetStates.get(SUMMARY_TAB_NAME)

    if (!summarySheetState) {
      throw new Error(`Google Sheets tab not found after creation: ${SUMMARY_TAB_NAME}`)
    }

    const updatedSummaryState = await writeStaticSheet({
      sheets,
      spreadsheetId,
      writeBuffer,
      sheetState: summarySheetState,
      rows: opts.summaryRows ?? [],
      operation: 'replace',
      onProgress: opts.onProgress
    })

    sheetStates.set(SUMMARY_TAB_NAME, updatedSummaryState)
  }

  await flushBufferedValueWrites({
    sheets,
    spreadsheetId,
    writeBuffer,
    reason: 'final flush'
  })

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

async function writeBucketToSheet(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  writeBuffer: ValueWriteBuffer
  sheetState: SheetState
  bucketTarget: GoogleSheetBucketTarget
  operation: 'append' | 'replace'
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
  onProgress?: (info: { bucket: string; rowsWritten: number; totalRowsForBucket: number }) => void
}): Promise<SheetState> {
  const {
    sheets,
    spreadsheetId,
    writeBuffer,
    sheetState,
    bucketTarget,
    operation,
    readChunk,
    onProgress
  } = args
  const { bucket, tabName } = bucketTarget
  const plan = await planBucketWrite(bucket, readChunk)

  const existingLastRow =
    operation === 'append'
      ? await detectLastUsedRow({
          sheets,
          spreadsheetId,
          tabName
        })
      : 0
  const shouldWriteHeader =
    plan.headers.length > 0 && (operation === 'replace' || existingLastRow === 0)
  const shouldWriteMessageRow = Boolean(plan.messageRow)
  const rowsToWrite =
    plan.totalDataRows + (shouldWriteHeader ? 1 : 0) + (shouldWriteMessageRow ? 1 : 0)

  if (rowsToWrite === 0) {
    await prepareSheetForWrite({
      sheets,
      spreadsheetId,
      sheetState,
      operation: 'replace',
      rowCount: MIN_SHEET_ROWS,
      columnCount: MIN_SHEET_COLUMNS
    })
    return sheetState
  }

  const startRow = existingLastRow + 1
  const requiredRows =
    operation === 'replace'
      ? Math.max(rowsToWrite, MIN_SHEET_ROWS)
      : Math.max(existingLastRow + rowsToWrite, sheetState.rowCount, MIN_SHEET_ROWS)
  const requiredColumns =
    operation === 'replace'
      ? Math.max(plan.maxColumnCount, MIN_SHEET_COLUMNS)
      : Math.max(sheetState.columnCount, plan.maxColumnCount, MIN_SHEET_COLUMNS)

  await prepareSheetForWrite({
    sheets,
    spreadsheetId,
    sheetState,
    operation,
    rowCount: requiredRows,
    columnCount: requiredColumns
  })

  // console.info('[gsheet-writer] bucket plan', {
  //   tabName,
  //   operation,
  //   existingLastRow,
  //   rowsToWrite,
  //   headerRow: shouldWriteHeader,
  //   messageRow: shouldWriteMessageRow,
  //   dataRows: plan.totalDataRows,
  //   maxRowWidth: plan.maxColumnCount,
  //   actualColumnCount: plan.maxColumnCount
  // })

  let currentRow = startRow
  let dataRowsProcessed = 0
  let pendingRows: SheetRow[] = []
  let pendingMaxWidth = 0
  const progressBaseRows = (shouldWriteHeader ? 1 : 0) + (plan.messageRow ? 1 : 0)

  const flushPendingRows = async (): Promise<void> => {
    if (pendingRows.length === 0) {
      return
    }

    const chunk = finalizeWriteChunk(pendingRows, pendingMaxWidth)
    const targetRange = buildTargetRange(tabName, currentRow, chunk.rows.length, chunk.maxWidth)

    // console.info('[gsheet-writer] writing chunk', {
    //   tabName,
    //   targetRange,
    //   rowCount: chunk.rows.length,
    //   maxRowWidth: chunk.maxWidth,
    //   actualColumnCount: plan.maxColumnCount
    // })

    await queueValueWrite({
      sheets,
      spreadsheetId,
      writeBuffer,
      write: {
        tabName,
        targetRange,
        rows: chunk.rows,
        rowCount: chunk.rows.length,
        maxWidth: chunk.maxWidth,
        cellCount: chunk.rows.length * Math.max(chunk.maxWidth, 1)
      }
    })

    currentRow += chunk.rows.length
    pendingRows = []
    pendingMaxWidth = 0
  }

  const enqueueRows = async (rows: SheetRow[]): Promise<void> => {
    for (const row of rows) {
      pendingRows.push(row)
      pendingMaxWidth = Math.max(pendingMaxWidth, row.length)

      const rowLimitReached = pendingRows.length >= MAX_ROWS_PER_WRITE
      const cellLimitReached =
        pendingRows.length * Math.max(pendingMaxWidth, 1) >= MAX_CELLS_PER_WRITE

      if (rowLimitReached || cellLimitReached) {
        await flushPendingRows()
      }
    }
  }

  if (shouldWriteHeader) {
    await enqueueRows([plan.headers])
  }

  if (plan.messageRow) {
    await enqueueRows([plan.messageRow])
  }

  for (const file of bucket.chunkFiles) {
    const rawRows =
      file === plan.previewFilePath && plan.previewRows ? plan.previewRows : await readChunk(file)

    if (rawRows.length === 0) {
      continue
    }

    const sanitizedRows = rawRows.map((row) => sanitizeObjectRow(row, plan.headers))

    await enqueueRows(sanitizedRows)

    dataRowsProcessed += sanitizedRows.length

    onProgress?.({
      bucket: tabName,
      rowsWritten: Math.min(progressBaseRows + dataRowsProcessed, rowsToWrite),
      totalRowsForBucket: rowsToWrite
    })
  }

  await flushPendingRows()

  onProgress?.({
    bucket: tabName,
    rowsWritten: rowsToWrite,
    totalRowsForBucket: rowsToWrite
  })

  return {
    ...sheetState,
    rowCount: requiredRows,
    columnCount: requiredColumns
  }
}

async function writeCombinedDataSheet(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  writeBuffer: ValueWriteBuffer
  sheetState: SheetState
  bucketTargets: GoogleSheetBucketTarget[]
  operation: 'append' | 'replace'
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
  onProgress?: (info: { bucket: string; rowsWritten: number; totalRowsForBucket: number }) => void
}): Promise<SheetState> {
  const {
    sheets,
    spreadsheetId,
    writeBuffer,
    sheetState,
    bucketTargets,
    operation,
    readChunk,
    onProgress
  } = args
  const plan = await planCombinedSheetWrite(bucketTargets, readChunk)
  const existingLastRow =
    operation === 'append'
      ? await detectLastUsedRow({
          sheets,
          spreadsheetId,
          tabName: sheetState.title
        })
      : 0
  const shouldWriteHeader =
    plan.headers.length > 0 && (operation === 'replace' || existingLastRow === 0)
  const shouldWriteMessageRow = Boolean(plan.messageRow)
  const rowsToWrite =
    plan.totalDataRows + (shouldWriteHeader ? 1 : 0) + (shouldWriteMessageRow ? 1 : 0)

  if (rowsToWrite === 0) {
    await prepareSheetForWrite({
      sheets,
      spreadsheetId,
      sheetState,
      operation: 'replace',
      rowCount: MIN_SHEET_ROWS,
      columnCount: MIN_SHEET_COLUMNS
    })

    return sheetState
  }

  const startRow = existingLastRow + 1
  const requiredRows =
    operation === 'replace'
      ? Math.max(rowsToWrite, MIN_SHEET_ROWS)
      : Math.max(existingLastRow + rowsToWrite, sheetState.rowCount, MIN_SHEET_ROWS)
  const requiredColumns =
    operation === 'replace'
      ? Math.max(plan.maxColumnCount, MIN_SHEET_COLUMNS)
      : Math.max(sheetState.columnCount, plan.maxColumnCount, MIN_SHEET_COLUMNS)

  await prepareSheetForWrite({
    sheets,
    spreadsheetId,
    sheetState,
    operation,
    rowCount: requiredRows,
    columnCount: requiredColumns
  })

  // console.info('[gsheet-writer] combined sheet plan', {
  //   tabName: sheetState.title,
  //   operation,
  //   existingLastRow,
  //   rowsToWrite,
  //   headerRow: shouldWriteHeader,
  //   messageRow: shouldWriteMessageRow,
  //   dataRows: plan.totalDataRows,
  //   maxRowWidth: plan.maxColumnCount,
  //   actualColumnCount: plan.maxColumnCount
  // })

  let currentRow = startRow
  let dataRowsProcessed = 0
  let pendingRows: SheetRow[] = []
  let pendingMaxWidth = 0
  const progressBaseRows = (shouldWriteHeader ? 1 : 0) + (plan.messageRow ? 1 : 0)

  const flushPendingRows = async (): Promise<void> => {
    if (pendingRows.length === 0) {
      return
    }

    const chunk = finalizeWriteChunk(pendingRows, pendingMaxWidth)
    const targetRange = buildTargetRange(
      sheetState.title,
      currentRow,
      chunk.rows.length,
      chunk.maxWidth
    )

    // console.info('[gsheet-writer] writing chunk', {
    //   tabName: sheetState.title,
    //   targetRange,
    //   rowCount: chunk.rows.length,
    //   maxRowWidth: chunk.maxWidth,
    //   actualColumnCount: plan.maxColumnCount
    // })

    await queueValueWrite({
      sheets,
      spreadsheetId,
      writeBuffer,
      write: {
        tabName: sheetState.title,
        targetRange,
        rows: chunk.rows,
        rowCount: chunk.rows.length,
        maxWidth: chunk.maxWidth,
        cellCount: chunk.rows.length * Math.max(chunk.maxWidth, 1)
      }
    })

    currentRow += chunk.rows.length
    pendingRows = []
    pendingMaxWidth = 0
  }

  const enqueueRows = async (rows: SheetRow[]): Promise<void> => {
    for (const row of rows) {
      pendingRows.push(row)
      pendingMaxWidth = Math.max(pendingMaxWidth, row.length)

      const rowLimitReached = pendingRows.length >= MAX_ROWS_PER_WRITE
      const cellLimitReached =
        pendingRows.length * Math.max(pendingMaxWidth, 1) >= MAX_CELLS_PER_WRITE

      if (rowLimitReached || cellLimitReached) {
        await flushPendingRows()
      }
    }
  }

  if (shouldWriteHeader) {
    await enqueueRows([plan.headers])
  }

  if (plan.messageRow) {
    await enqueueRows([plan.messageRow])
  }

  for (const bucketTarget of bucketTargets) {
    if ((bucketTarget.bucket.rowCount ?? 0) <= 0) {
      continue
    }

    for (const file of bucketTarget.bucket.chunkFiles) {
      const rawRows =
        bucketTarget.tabName === plan.previewTabName &&
        file === plan.previewFilePath &&
        plan.previewRows
          ? plan.previewRows
          : await readChunk(file)

      if (rawRows.length === 0) {
        continue
      }

      const combinedRows = rawRows.map((row) =>
        sanitizeArrayRow([bucketTarget.tabName, ...sanitizeObjectRow(row, plan.dataHeaders)])
      )

      await enqueueRows(combinedRows)

      dataRowsProcessed += combinedRows.length

      onProgress?.({
        bucket: sheetState.title,
        rowsWritten: Math.min(progressBaseRows + dataRowsProcessed, rowsToWrite),
        totalRowsForBucket: rowsToWrite
      })
    }
  }

  await flushPendingRows()

  onProgress?.({
    bucket: sheetState.title,
    rowsWritten: rowsToWrite,
    totalRowsForBucket: rowsToWrite
  })

  return {
    ...sheetState,
    rowCount: requiredRows,
    columnCount: requiredColumns
  }
}

async function writeStaticSheet(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  writeBuffer: ValueWriteBuffer
  sheetState: SheetState
  rows: unknown[][]
  operation: 'append' | 'replace'
  onProgress?: (info: { bucket: string; rowsWritten: number; totalRowsForBucket: number }) => void
}): Promise<SheetState> {
  const { sheets, spreadsheetId, writeBuffer, sheetState, rows, operation, onProgress } = args
  const sanitizedRows = rows.map((row) => sanitizeArrayRow(Array.isArray(row) ? row : []))
  const maxColumnCount = sanitizedRows.reduce((largest, row) => Math.max(largest, row.length), 0)
  const rowsToWrite = sanitizedRows.length

  if (rowsToWrite === 0) {
    await prepareSheetForWrite({
      sheets,
      spreadsheetId,
      sheetState,
      operation: 'replace',
      rowCount: MIN_SHEET_ROWS,
      columnCount: MIN_SHEET_COLUMNS
    })

    return sheetState
  }

  const existingLastRow =
    operation === 'append'
      ? await detectLastUsedRow({
          sheets,
          spreadsheetId,
          tabName: sheetState.title
        })
      : 0
  const startRow = existingLastRow + 1
  const requiredRows =
    operation === 'replace'
      ? Math.max(rowsToWrite, MIN_SHEET_ROWS)
      : Math.max(existingLastRow + rowsToWrite, sheetState.rowCount, MIN_SHEET_ROWS)
  const requiredColumns =
    operation === 'replace'
      ? Math.max(maxColumnCount, MIN_SHEET_COLUMNS)
      : Math.max(sheetState.columnCount, maxColumnCount, MIN_SHEET_COLUMNS)

  await prepareSheetForWrite({
    sheets,
    spreadsheetId,
    sheetState,
    operation,
    rowCount: requiredRows,
    columnCount: requiredColumns
  })

  const chunk = finalizeWriteChunk(sanitizedRows, maxColumnCount)
  const targetRange = buildTargetRange(
    sheetState.title,
    startRow,
    chunk.rows.length,
    chunk.maxWidth
  )

  // console.info('[gsheet-writer] writing static sheet', {
  //   tabName: sheetState.title,
  //   targetRange,
  //   rowCount: chunk.rows.length,
  //   maxRowWidth: chunk.maxWidth,
  //   actualColumnCount: chunk.maxWidth
  // })

  await queueValueWrite({
    sheets,
    spreadsheetId,
    writeBuffer,
    write: {
      tabName: sheetState.title,
      targetRange,
      rows: chunk.rows,
      rowCount: chunk.rows.length,
      maxWidth: chunk.maxWidth,
      cellCount: chunk.rows.length * Math.max(chunk.maxWidth, 1)
    }
  })

  onProgress?.({
    bucket: sheetState.title,
    rowsWritten: rowsToWrite,
    totalRowsForBucket: rowsToWrite
  })

  return {
    ...sheetState,
    rowCount: requiredRows,
    columnCount: requiredColumns
  }
}

async function planBucketWrite(
  bucket: GsheetBucket,
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
): Promise<BucketPlan> {
  let headers = sanitizeHeaderRow(bucket.columns)
  let previewFilePath: string | null = null
  let previewRows: Record<string, unknown>[] | null = null
  const totalDataRows = Math.max(bucket.rowCount ?? 0, 0)

  if (headers.length === 0 && totalDataRows > 0) {
    for (const file of bucket.chunkFiles) {
      const rawRows = await readChunk(file)

      if (rawRows.length === 0) {
        continue
      }

      previewFilePath = file
      previewRows = rawRows
      headers = sanitizeHeaderRow(Object.keys(rawRows[0] ?? {}))
      break
    }
  }

  let messageRow: SheetRow | null = null

  if (totalDataRows === 0) {
    if (bucket.error) {
      headers = prepareBucketHeaders(headers, bucket.error)
      if (headers.length === 0) {
        headers = ['Error']
      }
      messageRow = createErrorRow(headers, bucket.error)
    } else {
      headers = appendColumnHeader(headers, MESSAGE_COLUMN_NAME)
      if (headers.length === 0) {
        headers = [MESSAGE_COLUMN_NAME]
      }
      messageRow = createMessageRow(headers, NO_DATA_MESSAGE)
    }
  }

  return {
    headers,
    totalDataRows,
    maxColumnCount: Math.max(headers.length, messageRow?.length ?? 0, 1),
    previewFilePath,
    previewRows,
    messageRow
  }
}

async function planCombinedSheetWrite(
  bucketTargets: GoogleSheetBucketTarget[],
  readChunk: (filePath: string) => Promise<Record<string, unknown>[]>
): Promise<BucketPlan & { dataHeaders: string[]; previewTabName: string | null }> {
  const totalDataRows = bucketTargets.reduce(
    (total, target) => total + Math.max(target.bucket.rowCount ?? 0, 0),
    0
  )
  let dataHeaders: string[] = []
  let previewFilePath: string | null = null
  let previewRows: Record<string, unknown>[] | null = null
  let previewTabName: string | null = null

  for (const bucketTarget of bucketTargets) {
    if ((bucketTarget.bucket.rowCount ?? 0) <= 0) {
      continue
    }

    dataHeaders = sanitizeHeaderRow(bucketTarget.bucket.columns)
    if (dataHeaders.length > 0) {
      break
    }

    for (const file of bucketTarget.bucket.chunkFiles) {
      const rawRows = await readChunk(file)

      if (rawRows.length === 0) {
        continue
      }

      previewFilePath = file
      previewRows = rawRows
      previewTabName = bucketTarget.tabName
      dataHeaders = sanitizeHeaderRow(Object.keys(rawRows[0] ?? {}))
      break
    }

    if (dataHeaders.length > 0) {
      break
    }
  }

  let headers: string[] = []
  let messageRow: SheetRow | null = null

  if (totalDataRows > 0) {
    headers = ['Sheet Name', ...dataHeaders]
  } else {
    headers = [MESSAGE_COLUMN_NAME]
    messageRow = [NO_DATA_MESSAGE]
  }

  return {
    headers,
    dataHeaders,
    totalDataRows,
    maxColumnCount: Math.max(headers.length, messageRow?.length ?? 0, 1),
    previewFilePath,
    previewRows,
    previewTabName,
    messageRow
  }
}

async function ensureTabsExist(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetStates: Map<string, SheetState>,
  titles: string[]
): Promise<Map<string, SheetState>> {
  const tabsToCreate = new Set<string>()

  for (const title of titles) {
    if (!sheetStates.has(title)) {
      tabsToCreate.add(title)
    }
  }

  if (tabsToCreate.size === 0) {
    return sheetStates
  }

  await runThrottledWrite(`spreadsheet:${spreadsheetId}`, 'create tabs', () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: Array.from(tabsToCreate, (title) => ({
          addSheet: {
            properties: {
              title
            }
          }
        }))
      }
    })
  )

  return getSheetStates(sheets, spreadsheetId)
}

async function prepareSheetForWrite(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  sheetState: SheetState
  operation: 'append' | 'replace'
  rowCount: number
  columnCount: number
}): Promise<void> {
  const { sheets, spreadsheetId, sheetState, operation, rowCount, columnCount } = args
  const requests: sheets_v4.Schema$Request[] = []

  if (operation === 'replace') {
    requests.push({
      updateCells: {
        range: {
          sheetId: sheetState.sheetId
        },
        fields: 'userEnteredValue'
      }
    })
  }

  if (sheetState.rowCount !== rowCount || sheetState.columnCount !== columnCount) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: sheetState.sheetId,
          gridProperties: {
            rowCount,
            columnCount
          }
        },
        fields: 'gridProperties.rowCount,gridProperties.columnCount'
      }
    })
  }

  if (requests.length === 0) {
    return
  }

  // console.info('[gsheet-writer] preparing sheet', {
  //   tabName: sheetState.title,
  //   operation,
  //   fromRows: sheetState.rowCount,
  //   toRows: rowCount,
  //   fromColumns: sheetState.columnCount,
  //   toColumns: columnCount,
  //   requestCount: requests.length
  // })

  await runThrottledWrite(sheetState.title, `prepare ${sheetState.title}`, () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests
      }
    })
  )

  sheetState.rowCount = rowCount
  sheetState.columnCount = columnCount
}

async function getSheetStates(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<Map<string, SheetState>> {
  const response = await callWithRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    })
  )

  const states = new Map<string, SheetState>()

  for (const sheet of response.data.sheets ?? []) {
    const properties = sheet.properties
    const title = properties?.title
    const sheetId = properties?.sheetId

    if (!title || typeof sheetId !== 'number') {
      continue
    }

    states.set(title, {
      sheetId,
      title,
      rowCount: properties.gridProperties?.rowCount ?? MIN_SHEET_ROWS,
      columnCount: properties.gridProperties?.columnCount ?? MIN_SHEET_COLUMNS
    })
  }

  return states
}

async function detectLastUsedRow(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  tabName: string
}): Promise<number> {
  const { sheets, spreadsheetId, tabName } = args

  const response = await callWithRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetNameForRange(tabName),
      majorDimension: 'ROWS'
    })
  )

  const rows = Array.isArray(response.data.values) ? response.data.values : []
  let lastUsedRow = rows.length

  while (lastUsedRow > 0) {
    const row = rows[lastUsedRow - 1]
    const hasValue = Array.isArray(row) ? row.some((cell) => normalizeCell(cell) !== '') : false

    if (hasValue) {
      break
    }

    lastUsedRow -= 1
  }

  return lastUsedRow
}

function createValueWriteBuffer(): ValueWriteBuffer {
  return {
    writes: [],
    totalCells: 0
  }
}

async function queueValueWrite(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  writeBuffer: ValueWriteBuffer
  write: PendingValueWrite
}): Promise<void> {
  const { sheets, spreadsheetId, writeBuffer, write } = args

  const shouldFlushFirst =
    writeBuffer.writes.length > 0 &&
    (writeBuffer.writes.length >= MAX_RANGES_PER_BATCH_WRITE ||
      writeBuffer.totalCells + write.cellCount > MAX_CELLS_PER_BATCH_WRITE)

  if (shouldFlushFirst) {
    await flushBufferedValueWrites({
      sheets,
      spreadsheetId,
      writeBuffer,
      reason: `buffer full before ${write.targetRange}`
    })
  }

  writeBuffer.writes.push(write)
  writeBuffer.totalCells += write.cellCount
}

async function flushBufferedValueWrites(args: {
  sheets: sheets_v4.Sheets
  spreadsheetId: string
  writeBuffer: ValueWriteBuffer
  reason: string
}): Promise<void> {
  const { sheets, spreadsheetId, writeBuffer } = args

  if (writeBuffer.writes.length === 0) {
    return
  }

  const pendingWrites = [...writeBuffer.writes]

  // console.info('[gsheet-writer] flushing write buffer', {
  //   reason,
  //   rangeCount: pendingWrites.length,
  //   totalCells: writeBuffer.totalCells,
  //   tabs: Array.from(new Set(pendingWrites.map((write) => write.tabName))),
  //   ranges: pendingWrites.map((write) => write.targetRange)
  // })

  await runThrottledWrite(spreadsheetId, `write ${pendingWrites.length} range(s)`, () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: pendingWrites.map((write) => ({
          range: write.targetRange,
          values: write.rows
        }))
      }
    })
  )

  writeBuffer.writes = []
  writeBuffer.totalCells = 0
}

async function runThrottledWrite<T>(
  scope: string,
  action: string,
  fn: () => Promise<T>
): Promise<T> {
  return callWithRetry(() => withWriteThrottle(fn), { scope, action })
}

async function withWriteThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeQueue.catch(() => undefined)
  let releaseQueue: () => void = () => undefined

  writeQueue = new Promise((resolve) => {
    releaseQueue = resolve
  })

  await previous

  const elapsed = Date.now() - lastWriteCompletedAt

  if (elapsed < WRITE_DELAY_MS) {
    await sleep(WRITE_DELAY_MS - elapsed)
  }

  try {
    return await fn()
  } finally {
    lastWriteCompletedAt = Date.now()
    releaseQueue()
  }
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  context?: { scope?: string; action?: string }
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (!isRetryable(err)) {
        throw err
      }

      const delay = computeBackoff(attempt)

      console.warn('[gsheet-writer] retrying request', {
        scope: context?.scope,
        action: context?.action,
        attempt: attempt + 1,
        delay,
        status: extractStatus(err),
        message: extractErrorMessage(err)
      })

      await sleep(delay)
    }
  }

  throw lastError
}

function isRetryable(err: unknown): boolean {
  const code = extractStatus(err)

  if (code == null) {
    return false
  }

  return code === 408 || code === 429 || (code >= 500 && code <= 599)
}

function extractStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err == null) {
    return null
  }

  const error = err as {
    code?: number | string
    status?: number | string
    response?: { status?: number }
  }

  if (typeof error.code === 'number') {
    return error.code
  }

  if (typeof error.status === 'number') {
    return error.status
  }

  if (typeof error.code === 'string') {
    const parsedCode = Number(error.code)

    if (Number.isFinite(parsedCode)) {
      return parsedCode
    }
  }

  if (typeof error.status === 'string') {
    const parsedStatus = Number(error.status)

    if (Number.isFinite(parsedStatus)) {
      return parsedStatus
    }
  }

  if (typeof error.response?.status === 'number') {
    return error.response.status
  }

  return null
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

function computeBackoff(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 1000)

  return Math.min(base + jitter, 60000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseConfig(json: string): GoogleSheetsConfig {
  return parseJsonObjectInput(json, 'Google Sheets destination config') as GoogleSheetsConfig
}

function resolveSpreadsheetId(config: GoogleSheetsConfig): string {
  const candidate = config.spreadsheetId ?? config.sheet_id ?? config.spreadsheetUrl ?? ''

  if (!candidate.includes('/')) {
    return candidate
  }

  const match = candidate.match(/\/d\/([a-zA-Z0-9-_]+)/)

  if (!match) {
    throw new Error('Invalid spreadsheet URL')
  }

  return match[1]
}

function sanitizeSheetName(name: string): string {
  return (
    (name || 'Sheet1')
      .replace(/[\\/:?*]/g, '_')
      .replace(/\[|\]/g, '_')
      .slice(0, 100)
      .trim() || 'Sheet1'
  )
}

function loadServiceAccountCredentials(config: GoogleSheetsConfig): ServiceAccountCredentials {
  const raw = config.service_account_json ?? config.credentials_json ?? config.credentials

  if (!raw) {
    throw new Error('Missing credentials')
  }

  const parsed =
    typeof raw === 'string'
      ? parseJsonObjectInput(raw, 'Google service account JSON')
      : ensureJsonObject(raw, 'Google service account JSON')
  const email = parsed.client_email
  const privateKey = parsed.private_key

  if (typeof email !== 'string' || typeof privateKey !== 'string') {
    throw new Error('Invalid service account JSON')
  }

  let key = privateKey

  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n')
  }

  return {
    client_email: email,
    private_key: key
  }
}

function parseJsonObjectInput(input: string, label: string): Record<string, unknown> {
  const normalized = normalizeJsonText(input)
  const candidates = new Set<string>([normalized])

  if (normalized.startsWith('{{') && normalized.endsWith('}}')) {
    candidates.add(normalized.slice(1, -1).trim())
  }

  let lastError: unknown = new Error(`Invalid ${label}`)

  for (const candidate of candidates) {
    try {
      const parsed = parseNestedJson(candidate)

      return ensureJsonObject(parsed, label)
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`Invalid ${label}: ${extractErrorMessage(lastError)}`)
}

function normalizeJsonText(input: string): string {
  const withoutBom = input.replace(/^\uFEFF/, '').trim()
  const fencedMatch = withoutBom.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)

  return fencedMatch ? fencedMatch[1].trim() : withoutBom
}

function parseNestedJson(input: string): unknown {
  const parsed = JSON.parse(input)

  if (typeof parsed !== 'string') {
    return parsed
  }

  const nested = normalizeJsonText(parsed)

  if (!nested.startsWith('{') && !nested.startsWith('[')) {
    return parsed
  }

  return JSON.parse(nested)
}

function ensureJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }

  return value as Record<string, unknown>
}

function prepareBucketHeaders(columns: string[], error: string | null): string[] {
  const headers = sanitizeHeaderRow(columns)

  if (error && !headers.includes('Error')) {
    return [...headers, 'Error']
  }

  return headers
}

function sanitizeHeaderRow(headers: string[]): string[] {
  const normalized: string[] = []

  for (let index = 0; index < headers.length; index += 1) {
    const hasOwnIndex = Object.prototype.hasOwnProperty.call(headers, index)
    const value = hasOwnIndex ? headers[index] : ''

    normalized.push(value == null ? '' : String(value).trim())
  }

  let lastNonEmptyIndex = normalized.length - 1

  while (lastNonEmptyIndex >= 0 && normalized[lastNonEmptyIndex] === '') {
    lastNonEmptyIndex -= 1
  }

  return lastNonEmptyIndex >= 0 ? normalized.slice(0, lastNonEmptyIndex + 1) : []
}

function sanitizeObjectRow(row: Record<string, unknown>, headers: string[]): SheetRow {
  const source = row ?? {}

  if (headers.length === 0) {
    return sanitizeArrayRow(Object.keys(source).map((key) => source[key]))
  }

  return sanitizeArrayRow(headers.map((header) => source[header]))
}

function sanitizeArrayRow(input: unknown[]): SheetRow {
  const normalized: SheetRow = []

  for (let index = 0; index < input.length; index += 1) {
    const hasOwnIndex = Object.prototype.hasOwnProperty.call(input, index)
    const value = hasOwnIndex ? input[index] : ''

    normalized.push(normalizeCell(value))
  }

  let lastNonEmptyIndex = normalized.length - 1

  while (lastNonEmptyIndex >= 0 && normalized[lastNonEmptyIndex] === '') {
    lastNonEmptyIndex -= 1
  }

  if (lastNonEmptyIndex < 0) {
    return normalized.length > 0 ? [''] : []
  }

  return normalized.slice(0, lastNonEmptyIndex + 1)
}

function normalizeCell(value: unknown): SheetCell {
  if (value == null) {
    return ''
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

function createErrorRow(headers: string[], error: string): SheetRow {
  if (headers.length === 0) {
    return [error]
  }

  return sanitizeArrayRow(headers.map((header) => (header === 'Error' ? error : '')))
}

function createMessageRow(headers: string[], message: string): SheetRow {
  if (headers.length === 0) {
    return [message]
  }

  return sanitizeArrayRow(headers.map((_, index) => (index === 0 ? message : '')))
}

function appendColumnHeader(headers: string[], header: string): string[] {
  if (headers.includes(header)) {
    return headers
  }

  return [...headers, header]
}

function appendSheetSuffix(base: string, index: number): string {
  const suffix = `_${index}`
  const trimmedBase = base.slice(0, Math.max(1, 100 - suffix.length))

  return `${trimmedBase}${suffix}`
}

function finalizeWriteChunk(rows: SheetRow[], maxWidth: number): WriteChunk {
  const sanitizedRows = rows.map((row) => (row.length === 0 ? [''] : row))
  const computedMaxWidth = sanitizedRows.reduce((largest, row) => Math.max(largest, row.length), 0)

  return {
    rows: sanitizedRows,
    maxWidth: Math.max(maxWidth, computedMaxWidth, 1)
  }
}

function buildTargetRange(
  tabName: string,
  startRow: number,
  rowCount: number,
  columnCount: number
): string {
  const quotedTab = quoteSheetNameForRange(tabName)
  const endRow = startRow + rowCount - 1
  const endColumn = columnNumberToName(Math.max(columnCount, 1))

  return `${quotedTab}!A${startRow}:${endColumn}${endRow}`
}

function quoteSheetNameForRange(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`
}

function columnNumberToName(columnNumber: number): string {
  if (!Number.isInteger(columnNumber) || columnNumber < 1) {
    throw new Error(`Invalid Google Sheets column number: ${columnNumber}`)
  }

  let remaining = columnNumber
  let columnName = ''

  while (remaining > 0) {
    const remainder = (remaining - 1) % 26
    columnName = String.fromCharCode(65 + remainder) + columnName
    remaining = Math.floor((remaining - 1) / 26)
  }

  return columnName
}

export const __testing = {
  buildGoogleSheetBucketTargets,
  parseJsonObjectInput,
  loadServiceAccountCredentials,
  sanitizeHeaderRow,
  sanitizeArrayRow,
  sanitizeObjectRow,
  createErrorRow,
  buildTargetRange,
  columnNumberToName,
  quoteSheetNameForRange
}
