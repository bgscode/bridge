/**
 * Excel Combiner — converts a folder of CSV files into a combined XLSX report.
 *
 * Supports:
 *  - Plain combined Excel (one sheet per CSV file, named after the file)
 *  - Template-aware output (NEW → copy template, EXISTING → write in-place)
 *  - APPEND / REPLACE semantics for EXISTING templates
 *  - Streaming write for large datasets to avoid memory spikes
 *
 * PRD reference: src/ecelcombiner.md
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import ExcelJS from 'exceljs'
import type { CombineCsvFolderOptions, CombineCsvFolderResult } from '@shared/index'
import { settingsRepo } from '../../db/repositories/settings.repository'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rows buffered in memory per CSV before being committed to an .xlsx sheet. */
const STREAM_BUFFER_ROWS = 2_000
/** Excel's hard row cap per sheet. */
const EXCEL_ROW_HARD_CAP = 1_048_576
/** Default threshold (≈80% of hard cap) before rolling over to a new sheet. */
const DEFAULT_ROW_THRESHOLD = 800_000

function resolveRowThreshold(input: number | null | undefined): number {
  const raw = Number(input)
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), EXCEL_ROW_HARD_CAP)
  }
  // Fall back to the user-configured default from Settings.
  const fromSettings = Number(settingsRepo.getAll().excel_sheet_row_threshold)
  if (Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.min(Math.floor(fromSettings), EXCEL_ROW_HARD_CAP)
  }
  return DEFAULT_ROW_THRESHOLD
}

/**
 * Generate continuation sheet name. Index 0 → base, Index 1 → `${base}_2`, …
 * Falls back to timestamp-suffixed name if clash detected after 9999 tries.
 */
function rolloverSheetName(base: string, index: number, taken: Set<string>): string {
  const safeBase = sanitizeSheetName(base)
  if (index === 0) return uniqueSheetName(safeBase, taken)
  // Leave room for `_N` suffix.
  const stem = safeBase.slice(0, 28)
  return uniqueSheetName(`${stem}_${index + 1}`, taken)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeSheetName(name: string): string {
  const forbidden = ['\\', '/', '*', '?', ':', '[', ']']
  let out = name
  for (const ch of forbidden) out = out.split(ch).join('_')
  out = out.trim()
  return (out || 'Sheet').slice(0, 31)
}

function uniqueSheetName(base: string, taken: Set<string>): string {
  const safe = sanitizeSheetName(base)
  if (!taken.has(safe.toLowerCase())) {
    taken.add(safe.toLowerCase())
    return safe
  }
  let i = 2
  // leave 3 chars for "_NN"
  const trunc = safe.slice(0, 28)
  for (;;) {
    const candidate = `${trunc}_${i}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
    i++
    if (i > 9999) {
      const fallback = `${trunc}_${Date.now() % 10_000}`
      taken.add(fallback.toLowerCase())
      return fallback
    }
  }
}

function isXlsxPath(p: string): boolean {
  return /\.xlsx$/i.test(p)
}

// ─── CSV parsing (RFC 4180 minimal) ───────────────────────────────────────────

/**
 * Streaming CSV reader. Yields rows as string arrays.
 * Handles quoted fields, escaped quotes, and CRLF/LF line endings.
 */
async function* readCsvRows(filePath: string): AsyncGenerator<string[]> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 256 * 1024 })

  let field = ''
  let row: string[] = []
  let inQuotes = false
  let justClosedQuote = false

  for await (const chunkRaw of stream) {
    const chunk = String(chunkRaw)
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]

      if (inQuotes) {
        if (ch === '"') {
          if (chunk[i + 1] === '"') {
            field += '"'
            i++
          } else {
            inQuotes = false
            justClosedQuote = true
          }
        } else {
          field += ch
        }
        continue
      }

      if (ch === '"' && field.length === 0 && !justClosedQuote) {
        inQuotes = true
        continue
      }

      justClosedQuote = false

      if (ch === ',') {
        row.push(field)
        field = ''
        continue
      }

      if (ch === '\r') continue
      if (ch === '\n') {
        row.push(field)
        field = ''
        yield row
        row = []
        continue
      }

      field += ch
    }
  }

  // Trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    yield row
  }
}

// ─── Strip BOM from header ────────────────────────────────────────────────────

function stripBom(s: string): string {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

// ─── Folder analyzer ──────────────────────────────────────────────────────────

export interface CsvFileInfo {
  path: string
  name: string
  baseName: string
  sizeBytes: number
}

export async function analyzeFolder(folder: string): Promise<CsvFileInfo[]> {
  const entries = await fs.promises.readdir(folder, { withFileTypes: true })
  const files: CsvFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.csv$/i.test(entry.name)) continue
    if (entry.name.startsWith('_summary')) continue
    const full = path.join(folder, entry.name)
    const stat = await fs.promises.stat(full)
    files.push({
      path: full,
      name: entry.name,
      baseName: entry.name.replace(/\.csv$/i, ''),
      sizeBytes: stat.size
    })
  }
  files.sort((a, b) => a.name.localeCompare(b.name))
  return files
}

// ─── Decision ─────────────────────────────────────────────────────────────────

export interface CombineDecision {
  useStreaming: boolean
  reason: string
}

export function decideCombineStrategy(files: CsvFileInfo[]): CombineDecision {
  const totalBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0)
  const totalMB = totalBytes / (1024 * 1024)
  const totalRAM = os.totalmem()
  const ramGB = totalRAM / (1024 * 1024 * 1024)

  // Rough Excel size ≈ CSV × 1.2 (per PRD).
  const estimatedXlsxMB = totalMB * 1.2

  // Safe in-memory ceiling per available RAM tier.
  const safeInMemoryMB = ramGB >= 16 ? 60 : ramGB >= 8 ? 30 : ramGB >= 4 ? 15 : 8

  if (estimatedXlsxMB > safeInMemoryMB) {
    return {
      useStreaming: true,
      reason: `estimated ~${estimatedXlsxMB.toFixed(1)}MB xlsx; streaming (RAM ${ramGB.toFixed(1)}GB, safe limit ${safeInMemoryMB}MB)`
    }
  }

  return {
    useStreaming: false,
    reason: `estimated ~${estimatedXlsxMB.toFixed(1)}MB xlsx; in-memory write`
  }
}

// ─── Resolve output path ──────────────────────────────────────────────────────

function resolveOutputPath(folder: string, outputPath: string | null | undefined): string {
  const folderName = path.basename(folder) || 'combined'
  if (!outputPath) return path.join(folder, `${folderName}.xlsx`)

  try {
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
      return path.join(outputPath, `${folderName}.xlsx`)
    }
  } catch {
    // fall through
  }

  // If user gave a path without .xlsx suffix, treat as directory-like
  if (!isXlsxPath(outputPath)) {
    return path.join(outputPath, `${folderName}.xlsx`)
  }

  return outputPath
}

type CombineSummaryMeta = {
  folder: string
  outputFile: string
  csvDiscovered: number
  sheetCount: number
  totalRows: number
  skipped: string[]
}

function upsertSummarySheet(workbook: ExcelJS.Workbook, meta: CombineSummaryMeta): void {
  const existing = workbook.getWorksheet('Summary')
  if (existing) workbook.removeWorksheet(existing.id)

  const sheet = workbook.addWorksheet('Summary')
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 80 }
  ]

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }

  sheet.addRow({ metric: 'Folder', value: meta.folder })
  sheet.addRow({ metric: 'Output File', value: meta.outputFile })
  sheet.addRow({ metric: 'CSV Files Discovered', value: meta.csvDiscovered })
  sheet.addRow({ metric: 'Sheets Written', value: meta.sheetCount })
  sheet.addRow({ metric: 'Rows Written', value: meta.totalRows })

  if (meta.skipped.length > 0) {
    sheet.addRow({ metric: 'Skipped Files', value: '' })
    for (const entry of meta.skipped) {
      sheet.addRow({ metric: '-', value: entry })
    }
  }
}

function addStreamingSummarySheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  meta: CombineSummaryMeta
): void {
  const sheet = workbook.addWorksheet('Summary')
  const header = sheet.addRow(['Metric', 'Value'])
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
  header.commit()

  const rows: Array<[string, string | number]> = [
    ['Folder', meta.folder],
    ['Output File', meta.outputFile],
    ['CSV Files Discovered', meta.csvDiscovered],
    ['Sheets Written', meta.sheetCount],
    ['Rows Written', meta.totalRows]
  ]

  for (const [metric, value] of rows) {
    sheet.addRow([metric, value]).commit()
  }

  if (meta.skipped.length > 0) {
    sheet.addRow(['Skipped Files', '']).commit()
    for (const entry of meta.skipped) {
      sheet.addRow(['-', entry]).commit()
    }
  }

  sheet.commit()
}

// ─── In-memory writer (small/medium datasets) ─────────────────────────

async function importSummaryCsvIntoWorkbook(
  workbook: ExcelJS.Workbook,
  folder: string
): Promise<boolean> {
  const summaryCsv = await findSummaryCsv(folder)
  if (!summaryCsv) return false

  const existing = workbook.getWorksheet('Summary')
  if (existing) workbook.removeWorksheet(existing.id)

  const sheet = workbook.addWorksheet('Summary')
  let isFirst = true
  for await (const row of readCsvRows(summaryCsv)) {
    if (isFirst) {
      isFirst = false
      const headerRow = sheet.addRow(row.map((h, i) => (i === 0 ? stripBom(h) : h)))
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
      continue
    }
    sheet.addRow(row)
  }
  return true
}

async function importSummaryCsvIntoStream(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  folder: string
): Promise<boolean> {
  const summaryCsv = await findSummaryCsv(folder)
  if (!summaryCsv) return false

  const sheet = workbook.addWorksheet('Summary')
  let isFirst = true
  for await (const row of readCsvRows(summaryCsv)) {
    if (isFirst) {
      isFirst = false
      const hr = sheet.addRow(row.map((h, i) => (i === 0 ? stripBom(h) : h)))
      hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
      hr.commit()
      continue
    }
    sheet.addRow(row).commit()
  }
  sheet.commit()
  return true
}

async function findSummaryCsv(folder: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(folder, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && /^_summary.*\.csv$/i.test(entry.name)) {
        return path.join(folder, entry.name)
      }
    }
  } catch {
    // ignore
  }
  return null
}

// ─── In-memory writer (small/medium datasets) ─────────────────────────────────

async function writeInMemory(
  outputFile: string,
  files: CsvFileInfo[],
  options: CombineCsvFolderOptions
): Promise<{ sheetCount: number; totalRows: number; skipped: string[] }> {
  const workbook = new ExcelJS.Workbook()
  const takenSheetNames = new Set<string>()
  const skipped: string[] = []
  let totalRows = 0
  let sheetCount = 0
  const threshold = resolveRowThreshold(options.row_threshold)

  const isExistingTemplate = Boolean(options.template_path && options.template_mode === 'existing')

  // When existing template is used, load it and capture existing sheet names.
  if (isExistingTemplate && options.template_path) {
    await workbook.xlsx.readFile(options.template_path)
    for (const ws of workbook.worksheets) {
      takenSheetNames.add(ws.name.toLowerCase())
    }
  }

  // Reserve Summary for metadata sheet so data sheet names never collide.
  takenSheetNames.add('summary')

  for (const file of files) {
    const baseName = file.baseName
    const sanitizedBase = sanitizeSheetName(baseName)

    // Existing template + append → reuse first sheet matching base name.
    // Existing template + replace → wipe sheet matching base, recreate.
    const firstExistingIdx = workbook.worksheets.findIndex(
      (w) => w.name.toLowerCase() === sanitizedBase.toLowerCase()
    )
    const firstExisting = firstExistingIdx >= 0 ? workbook.worksheets[firstExistingIdx] : null

    let sheet: ExcelJS.Worksheet
    let isReusingExisting = false
    if (firstExisting && isExistingTemplate && options.operation === 'append') {
      sheet = firstExisting
      isReusingExisting = true
    } else {
      if (firstExisting) {
        workbook.removeWorksheet(firstExisting.id)
        takenSheetNames.delete(firstExisting.name.toLowerCase())
      }
      sheet = workbook.addWorksheet(uniqueSheetName(sanitizedBase, takenSheetNames))
    }

    let rollOverIndex = 0
    let rowsInSheet = sheet.rowCount
    let headers: string[] | null = null
    if (rowsInSheet > 0 && isReusingExisting) {
      const first = sheet.getRow(1)
      headers = []
      first.eachCell({ includeEmpty: true }, (cell) => {
        headers!.push(cell.value != null ? String(cell.value) : '')
      })
    }

    const openNewSheet = (): void => {
      rollOverIndex++
      sheet = workbook.addWorksheet(
        rolloverSheetName(sanitizedBase, rollOverIndex, takenSheetNames)
      )
      rowsInSheet = 0
      if (headers) {
        const hr = sheet.addRow(headers)
        hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } }
        rowsInSheet = 1
      }
      sheetCount++
    }

    let isFirst = true
    let wroteAny = false

    try {
      for await (const row of readCsvRows(file.path)) {
        if (isFirst) {
          isFirst = false
          const csvHeaders = row.map((h, i) => (i === 0 ? stripBom(h) : h))
          if (!headers) {
            headers = csvHeaders
            const hr = sheet.addRow(headers)
            hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
            hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } }
            rowsInSheet++
          }
          continue
        }

        // Rollover when threshold reached (leave room for current row).
        if (rowsInSheet >= threshold) openNewSheet()

        const values = headers!.map((_, i) => row[i] ?? '')
        sheet.addRow(values)
        rowsInSheet++
        totalRows++
        wroteAny = true
      }
    } catch (err) {
      skipped.push(`${file.name}: ${err instanceof Error ? err.message : 'read error'}`)
      continue
    }

    if (wroteAny) sheetCount++
    else if (isFirst) skipped.push(`${file.name}: empty`)
  }

  // Summary: prefer _summary.csv from job output; fall back to auto metadata.
  // In EXISTING template mode, keep unrelated template sheets untouched — only
  // replace Summary if _summary.csv is present (otherwise leave template as-is).
  const importedSummary = await importSummaryCsvIntoWorkbook(workbook, options.folder)
  if (!importedSummary && !isExistingTemplate) {
    upsertSummarySheet(workbook, {
      folder: options.folder,
      outputFile,
      csvDiscovered: files.length,
      sheetCount,
      totalRows,
      skipped
    })
  }

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await workbook.xlsx.writeFile(outputFile)

  return { sheetCount, totalRows, skipped }
}

// ─── Streaming writer (large datasets) ───────────────────────────────────────

async function writeStreaming(
  outputFile: string,
  files: CsvFileInfo[],
  options: CombineCsvFolderOptions
): Promise<{ sheetCount: number; totalRows: number; skipped: string[] }> {
  // ExcelJS streaming writer cannot edit in-place → fall back to in-memory for
  // template modes (needed so existing template sheets/formulas are preserved).
  if (options.template_path && options.template_mode === 'existing') {
    return writeInMemory(outputFile, files, options)
  }
  if (options.template_path && options.template_mode === 'new') {
    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
    await fs.promises.copyFile(options.template_path, outputFile)
    return writeInMemory(outputFile, files, options)
  }

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputFile,
    useStyles: true,
    useSharedStrings: false
  })

  const taken = new Set<string>()
  taken.add('summary')
  const skipped: string[] = []
  let totalRows = 0
  let sheetCount = 0
  const threshold = resolveRowThreshold(options.row_threshold)

  for (const file of files) {
    const sanitizedBase = sanitizeSheetName(file.baseName)
    let sheet = workbook.addWorksheet(uniqueSheetName(sanitizedBase, taken))
    let rollOverIndex = 0
    let headers: string[] | null = null
    let isFirst = true
    let buffered: string[][] = []
    let wroteAny = false
    let rowsInSheet = 0

    const writeHeader = (): void => {
      if (!headers) return
      const hr = sheet.addRow(headers)
      hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } }
      hr.commit()
      rowsInSheet++
    }

    const rolloverSheet = (): void => {
      sheet.commit()
      sheetCount++
      rollOverIndex++
      sheet = workbook.addWorksheet(rolloverSheetName(sanitizedBase, rollOverIndex, taken))
      rowsInSheet = 0
      writeHeader()
    }

    const flush = (): void => {
      if (!headers) return
      for (const r of buffered) {
        if (rowsInSheet >= threshold) rolloverSheet()
        const values = headers.map((_, i) => r[i] ?? '')
        sheet.addRow(values).commit()
        rowsInSheet++
      }
      buffered = []
    }

    try {
      for await (const row of readCsvRows(file.path)) {
        if (isFirst) {
          isFirst = false
          headers = row.map((h, i) => (i === 0 ? stripBom(h) : h))
          writeHeader()
          continue
        }

        buffered.push(row)
        totalRows++
        wroteAny = true
        if (buffered.length >= STREAM_BUFFER_ROWS) flush()
      }
      flush()
    } catch (err) {
      skipped.push(`${file.name}: ${err instanceof Error ? err.message : 'read error'}`)
      continue
    }

    sheet.commit()
    if (wroteAny) sheetCount++
    else if (isFirst) skipped.push(`${file.name}: empty`)
  }

  const importedSummary = await importSummaryCsvIntoStream(workbook, options.folder)
  if (!importedSummary) {
    addStreamingSummarySheet(workbook, {
      folder: options.folder,
      outputFile,
      csvDiscovered: files.length,
      sheetCount,
      totalRows,
      skipped
    })
  }

  await workbook.commit()
  return { sheetCount, totalRows, skipped }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function combineCsvFolder(
  options: CombineCsvFolderOptions
): Promise<CombineCsvFolderResult> {
  const folder = options.folder
  if (!folder) throw new Error('folder is required')
  const stat = await fs.promises.stat(folder).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Folder not found: ${folder}`)
  }

  // Validate template
  if (options.template_path) {
    if (!isXlsxPath(options.template_path)) {
      throw new Error('Template must be a .xlsx file')
    }
    const tStat = await fs.promises.stat(options.template_path).catch(() => null)
    if (!tStat || !tStat.isFile()) {
      throw new Error(`Template not found: ${options.template_path}`)
    }
    if (!options.template_mode) {
      throw new Error('template_mode is required when template_path is provided')
    }
  }

  const files = await analyzeFolder(folder)
  if (files.length === 0) {
    throw new Error(`No CSV files found in folder: ${folder}`)
  }

  const decision = decideCombineStrategy(files)
  const outputFile = resolveOutputPath(folder, options.output_path ?? null)

  // NEW mode: pre-copy template so output file starts from a template copy.
  if (options.template_path && options.template_mode === 'new' && !decision.useStreaming) {
    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
    await fs.promises.copyFile(options.template_path, outputFile)
  }

  // If template is attached, combine should update the template file in-place.
  // This preserves extra sheets while applying append/replace per connection sheet.
  const forceExistingTemplate = Boolean(options.template_path)

  // For EXISTING mode we write INTO the template file → outputFile = template_path
  let effectiveOutput = outputFile
  if (options.template_path && (options.template_mode === 'existing' || forceExistingTemplate)) {
    effectiveOutput = options.template_path
  }

  // When NEW mode + in-memory, we need to load the template copy so writeInMemory
  // preserves the template sheets. Attach a pre-load by setting template mode to
  // 'existing' semantics for the writer (keeping op as replace).
  const writerOptions: CombineCsvFolderOptions = { ...options }
  if (forceExistingTemplate && options.template_path) {
    writerOptions.template_mode = 'existing'
    writerOptions.operation = options.operation ?? 'replace'
  }
  if (options.template_path && options.template_mode === 'new' && !decision.useStreaming) {
    // After pre-copy, the output file IS a template copy — load it.
    writerOptions.template_path = effectiveOutput
    writerOptions.template_mode = 'existing'
    // Operation defaults to replace so we don't append to template's empty
    // placeholder data by accident unless user asked for append.
    writerOptions.operation = options.operation ?? 'replace'
  }

  const result = decision.useStreaming
    ? await writeStreaming(effectiveOutput, files, writerOptions)
    : await writeInMemory(effectiveOutput, files, writerOptions)

  // Post-combine cleanup: the CSV source folder is transient — we only want
  // the combined Excel to remain on disk. If the Excel lives inside the CSV
  // folder (default), move it to the parent directory first; then recursively
  // delete the CSV folder. If the Excel is a user-supplied template file
  // outside the folder, we simply remove the folder.
  let finalOutputPath = effectiveOutput
  const folderResolved = path.resolve(folder)
  const outputResolved = path.resolve(effectiveOutput)
  const outputDirResolved = path.resolve(path.dirname(effectiveOutput))
  const outputInsideFolder =
    outputDirResolved === folderResolved || outputDirResolved.startsWith(folderResolved + path.sep)

  if (outputInsideFolder) {
    const parent = path.dirname(folderResolved)
    let target = path.join(parent, path.basename(outputResolved))
    // Avoid clobbering an existing file in the parent directory.
    if (fs.existsSync(target) && path.resolve(target) !== outputResolved) {
      const parsed = path.parse(target)
      target = path.join(parsed.dir, `${parsed.name}_${Date.now()}${parsed.ext}`)
    }
    await fs.promises.rename(outputResolved, target)
    finalOutputPath = target
  }

  // Always remove the CSV source folder after a successful combine.
  await fs.promises.rm(folderResolved, { recursive: true, force: true }).catch(() => {
    // Best-effort cleanup — do not fail the combine on deletion issues.
  })

  return {
    output_paths: [finalOutputPath],
    sheet_count: result.sheetCount,
    total_rows: result.totalRows,
    skipped_files: result.skipped
  }
}
