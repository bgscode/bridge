import fs from 'fs'
import os from 'os'
import path from 'path'
import Papa from 'papaparse'
import ExcelJS from 'exceljs'

export interface ActionFilePreview {
  fileType: 'csv' | 'xlsx'
  headers: string[]
  sampleRows: Record<string, unknown>[]
  totalSampledRows: number
  sheetNames?: string[]
  activeSheet?: string
}

export interface ActionFileData {
  fileType: 'csv' | 'xlsx'
  headers: string[]
  rows: Record<string, unknown>[]
  sheetName?: string
}

function normalizeHeader(value: unknown, index: number): string {
  const raw = String(value ?? '').trim()
  return raw || `column_${index + 1}`
}

function uniqueHeaders(rawHeaders: string[]): string[] {
  const used = new Map<string, number>()
  return rawHeaders.map((h) => {
    const base = h || 'column'
    const count = (used.get(base) ?? 0) + 1
    used.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

function parseCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('')
    }
    if ('result' in value) return value.result ?? ''
    if ('hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink
    if ('formula' in value && typeof value.formula === 'string') {
      return value.result ?? value.formula
    }
  }
  return String(value)
}

async function previewCsv(stagedPath: string, sampleLimit: number): Promise<ActionFilePreview> {
  const raw = await fs.promises.readFile(stagedPath, 'utf-8')
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    preview: sampleLimit,
    transformHeader: (h) => h.trim()
  })

  const parseError = parsed.errors.find(
    (e) => e.type === 'Delimiter' || e.code === 'UndetectableDelimiter'
  )
  if (parseError) {
    throw new Error(`Unable to parse CSV: ${parseError.message}`)
  }

  const rawHeaderKeys = (parsed.meta.fields ?? []).map((h) => h.trim())
  if (rawHeaderKeys.length === 0) {
    throw new Error('CSV header row is empty or invalid')
  }

  const normalizedHeaders = rawHeaderKeys.map((h, i) => normalizeHeader(h, i))
  const headers = uniqueHeaders(normalizedHeaders)
  const sampleRows = parsed.data.map((row) => {
    const out: Record<string, unknown> = {}
    for (let i = 0; i < headers.length; i++) {
      const sourceKey = rawHeaderKeys[i]
      out[headers[i]] = row[sourceKey] ?? ''
    }
    return out
  })

  return {
    fileType: 'csv',
    headers,
    sampleRows,
    totalSampledRows: sampleRows.length
  }
}

async function previewExcel(
  stagedPath: string,
  sampleLimit: number,
  sheetName?: string
): Promise<ActionFilePreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(stagedPath)

  const sheetNames = workbook.worksheets.map((w) => w.name)
  if (sheetNames.length === 0) {
    throw new Error('Excel file has no worksheets')
  }

  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0]
  if (!sheet) {
    throw new Error(`Worksheet not found: ${sheetName}`)
  }

  const headerRow = sheet.getRow(1)
  const rawHeaders: string[] = []
  for (let i = 1; i <= Math.max(1, headerRow.cellCount); i++) {
    rawHeaders.push(normalizeHeader(parseCellValue(headerRow.getCell(i).value), i - 1))
  }
  const headers = uniqueHeaders(rawHeaders)

  const sampleRows: Record<string, unknown>[] = []
  for (
    let rowIndex = 2;
    rowIndex <= sheet.rowCount && sampleRows.length < sampleLimit;
    rowIndex++
  ) {
    const row = sheet.getRow(rowIndex)
    const out: Record<string, unknown> = {}
    let hasData = false
    for (let i = 0; i < headers.length; i++) {
      const value = parseCellValue(row.getCell(i + 1).value)
      out[headers[i]] = value
      if (value !== '' && value !== null) hasData = true
    }
    if (hasData) {
      sampleRows.push(out)
    }
  }

  return {
    fileType: 'xlsx',
    headers,
    sampleRows,
    totalSampledRows: sampleRows.length,
    sheetNames,
    activeSheet: sheet.name
  }
}

export async function previewActionFile(
  stagedPath: string,
  options?: { sampleRows?: number; sheetName?: string }
): Promise<ActionFilePreview> {
  const sampleLimit = Math.max(1, Math.min(options?.sampleRows ?? 20, 200))
  const ext = path.extname(stagedPath).toLowerCase()

  if (ext === '.csv') {
    return previewCsv(stagedPath, sampleLimit)
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return previewExcel(stagedPath, sampleLimit, options?.sheetName)
  }

  throw new Error('Unsupported file type. Use CSV or Excel (.xlsx/.xls).')
}

export async function readActionFileRows(
  stagedPath: string,
  options?: { sheetName?: string }
): Promise<ActionFileData> {
  const ext = path.extname(stagedPath).toLowerCase()

  if (ext === '.csv') {
    const raw = await fs.promises.readFile(stagedPath, 'utf-8')
    const parsed = Papa.parse<Record<string, unknown>>(raw, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      dynamicTyping: true
    })

    const rawHeaderKeys = (parsed.meta.fields ?? []).map((h) => h.trim())
    if (rawHeaderKeys.length === 0) {
      throw new Error('CSV header row is empty or invalid')
    }

    const normalizedHeaders = rawHeaderKeys.map((h, i) => normalizeHeader(h, i))
    const headers = uniqueHeaders(normalizedHeaders)
    const rows = parsed.data.map((row) => {
      const out: Record<string, unknown> = {}
      for (let i = 0; i < headers.length; i++) {
        const sourceKey = rawHeaderKeys[i]
        out[headers[i]] = row[sourceKey] ?? null
      }
      return out
    })

    return { fileType: 'csv', headers, rows }
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(stagedPath)

    const sheet = options?.sheetName
      ? workbook.getWorksheet(options.sheetName)
      : workbook.worksheets[0]
    if (!sheet) {
      throw new Error(`Worksheet not found: ${options?.sheetName ?? ''}`)
    }

    const headerRow = sheet.getRow(1)
    const rawHeaders: string[] = []
    for (let i = 1; i <= Math.max(1, headerRow.cellCount); i++) {
      rawHeaders.push(normalizeHeader(parseCellValue(headerRow.getCell(i).value), i - 1))
    }
    const headers = uniqueHeaders(rawHeaders)

    const rows: Record<string, unknown>[] = []
    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
      const row = sheet.getRow(rowIndex)
      const out: Record<string, unknown> = {}
      let hasData = false
      for (let i = 0; i < headers.length; i++) {
        const value = parseCellValue(row.getCell(i + 1).value)
        out[headers[i]] = value
        if (value !== '' && value !== null) hasData = true
      }
      if (hasData) {
        rows.push(out)
      }
    }

    return {
      fileType: 'xlsx',
      headers,
      rows,
      sheetName: sheet.name
    }
  }

  throw new Error('Unsupported file type. Use CSV or Excel (.xlsx/.xls).')
}

export interface ActionFileChunkStore {
  fileType: 'csv' | 'xlsx'
  headers: string[]
  chunkFiles: string[]
  sheetName?: string
  totalRows: number
  /** Remove temp chunk directory. Safe to call more than once. */
  cleanup: () => Promise<void>
}

const ACTION_CHUNK_SIZE = 2000

/**
 * Stream an action CSV/XLSX into NDJSON chunk files on disk so the executor
 * never holds millions of rows in RAM. Each chunk has ≤ ACTION_CHUNK_SIZE rows.
 */
export async function materializeActionFileChunks(
  stagedPath: string,
  options?: { sheetName?: string; chunkSize?: number; tempDir?: string }
): Promise<ActionFileChunkStore> {
  const chunkSize = Math.max(100, Math.min(options?.chunkSize ?? ACTION_CHUNK_SIZE, 5000))
  const ext = path.extname(stagedPath).toLowerCase()
  const tempRoot =
    options?.tempDir ??
    path.join(os.tmpdir(), `bridge-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await fs.promises.mkdir(tempRoot, { recursive: true })

  const cleanup = async (): Promise<void> => {
    try {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }

  try {
    if (ext === '.csv') {
      return await materializeCsvChunks(stagedPath, tempRoot, chunkSize, cleanup)
    }
    if (ext === '.xlsx' || ext === '.xls') {
      return await materializeExcelChunks(
        stagedPath,
        tempRoot,
        chunkSize,
        cleanup,
        options?.sheetName
      )
    }
    throw new Error('Unsupported file type. Use CSV or Excel (.xlsx/.xls).')
  } catch (err) {
    await cleanup()
    throw err
  }
}

async function flushActionChunk(
  tempRoot: string,
  chunkIndex: number,
  rows: Record<string, unknown>[]
): Promise<string> {
  const filePath = path.join(tempRoot, `chunk-${chunkIndex}.ndjson`)
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  await fs.promises.writeFile(filePath, body, 'utf-8')
  return filePath
}

async function materializeCsvChunks(
  stagedPath: string,
  tempRoot: string,
  chunkSize: number,
  cleanup: () => Promise<void>
): Promise<ActionFileChunkStore> {
  const chunkFiles: string[] = []
  let headers: string[] = []
  let rawHeaderKeys: string[] = []
  let batch: Record<string, unknown>[] = []
  let chunkIndex = 0
  let totalRows = 0
  let headersReady = false
  let pendingFlushes = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      resolve()
    }

    const stream = fs.createReadStream(stagedPath, { encoding: 'utf-8' })
    Papa.parse<Record<string, unknown>>(stream, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      dynamicTyping: true,
      step: (results, parser) => {
        try {
          if (!headersReady) {
            rawHeaderKeys = (results.meta.fields ?? []).map((h) => h.trim())
            if (rawHeaderKeys.length === 0) {
              parser.abort()
              fail(new Error('CSV header row is empty or invalid'))
              return
            }
            headers = uniqueHeaders(rawHeaderKeys.map((h, i) => normalizeHeader(h, i)))
            headersReady = true
          }

          const row = results.data
          if (!row || typeof row !== 'object') return
          const out: Record<string, unknown> = {}
          for (let i = 0; i < headers.length; i++) {
            out[headers[i]] = row[rawHeaderKeys[i]] ?? null
          }
          batch.push(out)
          totalRows++

          if (batch.length >= chunkSize) {
            // Pause while we flush so the queue cannot grow unbounded.
            parser.pause()
            const toFlush = batch
            batch = []
            const idx = chunkIndex++
            pendingFlushes++
            void flushActionChunk(tempRoot, idx, toFlush)
              .then((fp) => {
                chunkFiles.push(fp)
                pendingFlushes--
                parser.resume()
              })
              .catch((err) => {
                parser.abort()
                fail(err)
              })
          }
        } catch (err) {
          parser.abort()
          fail(err)
        }
      },
      complete: () => {
        void (async () => {
          try {
            // Wait for any in-flight chunk flushes started from step().
            while (pendingFlushes > 0) {
              await new Promise((r) => setTimeout(r, 10))
            }
            if (batch.length > 0) {
              chunkFiles.push(await flushActionChunk(tempRoot, chunkIndex++, batch))
              batch = []
            }
            if (!headersReady) {
              fail(new Error('CSV header row is empty or invalid'))
              return
            }
            // Keep chunk file order stable (async flushes may finish out of order).
            chunkFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            succeed()
          } catch (err) {
            fail(err)
          }
        })()
      },
      error: (err) => {
        fail(err)
      }
    })
  })

  return {
    fileType: 'csv',
    headers,
    chunkFiles,
    totalRows,
    cleanup
  }
}

async function materializeExcelChunks(
  stagedPath: string,
  tempRoot: string,
  chunkSize: number,
  cleanup: () => Promise<void>,
  sheetName?: string
): Promise<ActionFileChunkStore> {
  // Prefer streaming reader so we never hold the full sheet model in heap.
  const stream = fs.createReadStream(stagedPath)
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    worksheets: 'emit'
  })

  let headers: string[] = []
  let activeSheetName: string | undefined
  let batch: Record<string, unknown>[] = []
  let chunkIndex = 0
  let totalRows = 0
  const chunkFiles: string[] = []
  let matchedSheet = false
  let headerParsed = false

  for await (const worksheetReader of reader) {
    const wsAny = worksheetReader as unknown as { name?: string; id?: number }
    const wsName = typeof wsAny.name === 'string' && wsAny.name ? wsAny.name : `Sheet${String(wsAny.id ?? '')}`

    // Pick the requested sheet, or the first sheet when none specified.
    if (sheetName) {
      if (wsName !== sheetName) {
        // Drain unread rows so the reader can advance.
        for await (const _row of worksheetReader) {
          // skip
        }
        continue
      }
    } else if (matchedSheet) {
      for await (const _row of worksheetReader) {
        // skip remaining sheets
      }
      continue
    }

    matchedSheet = true
    activeSheetName = wsName

    for await (const row of worksheetReader) {
      const values = (row as { values?: ExcelJS.CellValue[] }).values
      if (!values || !Array.isArray(values)) continue

      // ExcelJS row.values is 1-indexed (index 0 unused).
      if (!headerParsed) {
        const rawHeaders: string[] = []
        for (let i = 1; i < values.length; i++) {
          rawHeaders.push(normalizeHeader(parseCellValue(values[i] as ExcelJS.CellValue), i - 1))
        }
        if (rawHeaders.length === 0) {
          throw new Error('Excel header row is empty or invalid')
        }
        headers = uniqueHeaders(rawHeaders)
        headerParsed = true
        continue
      }

      const out: Record<string, unknown> = {}
      let hasData = false
      for (let i = 0; i < headers.length; i++) {
        const value = parseCellValue((values[i + 1] as ExcelJS.CellValue) ?? null)
        out[headers[i]] = value
        if (value !== '' && value !== null) hasData = true
      }
      if (!hasData) continue

      batch.push(out)
      totalRows++
      if (batch.length >= chunkSize) {
        chunkFiles.push(await flushActionChunk(tempRoot, chunkIndex++, batch))
        batch = []
      }
    }
  }

  if (sheetName && !matchedSheet) {
    throw new Error(`Worksheet not found: ${sheetName}`)
  }
  if (!headerParsed || headers.length === 0) {
    throw new Error('Excel file has no worksheets or empty header')
  }
  if (batch.length > 0) {
    chunkFiles.push(await flushActionChunk(tempRoot, chunkIndex++, batch))
  }

  return {
    fileType: 'xlsx',
    headers,
    chunkFiles,
    sheetName: activeSheetName,
    totalRows,
    cleanup
  }
}

/** Read one NDJSON action chunk file (bounded size). */
export async function readActionChunkFile(
  filePath: string
): Promise<Record<string, unknown>[]> {
  const data = await fs.promises.readFile(filePath, 'utf-8')
  if (!data) return []
  const rows: Record<string, unknown>[] = []
  let start = 0
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) !== 0x0a) continue
    if (i > start) {
      const line =
        data.charCodeAt(i - 1) === 0x0d ? data.slice(start, i - 1) : data.slice(start, i)
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
