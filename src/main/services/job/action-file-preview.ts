import fs from 'fs'
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
