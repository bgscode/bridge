import type { Table } from '@tanstack/react-table'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import type { ExportOptions } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getExportColumns<TData>(table: Table<TData>): { id: string; header: string }[] {
  return table
    .getVisibleLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions')
    .map((col) => {
      const header = col.columnDef.header
      return { id: col.id, header: typeof header === 'string' ? header : col.id }
    })
}

function getExportRows<TData>(
  table: Table<TData>,
  columnIds: string[],
  selectedOnly: boolean
): (string | number | boolean | null)[][] {
  const allRows = table.getFilteredRowModel().rows
  const filtered = selectedOnly ? allRows.filter((r) => r.getIsSelected()) : allRows
  return filtered.map((row) =>
    columnIds.map((id) => {
      const val = (row.original as Record<string, unknown>)[id]
      if (val === undefined || val === null) return ''
      return val as string | number | boolean
    })
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export function exportToCSV<TData>(table: Table<TData>, options: ExportOptions): void {
  const cols = getExportColumns(table)
  const rows = getExportRows(
    table,
    cols.map((c) => c.id),
    options.selectedOnly ?? false
  )
  const csv = Papa.unparse({ fields: cols.map((c) => c.header), data: rows })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `${options.filename ?? 'export'}.csv`)
}

// ─── Excel Export — ExcelJS (supports styles, formulas, freeze panes) ─────────

export async function exportToExcel<TData>(
  table: Table<TData>,
  options: ExportOptions
): Promise<void> {
  const cols = getExportColumns(table)
  const rows = getExportRows(
    table,
    cols.map((c) => c.id),
    options.selectedOnly ?? false
  )

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Bridge App'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Data', {
    views: [{ state: 'frozen', ySplit: 1 }] // freeze header row
  })

  // ── Column definitions with auto width ───────────────────────────────────
  sheet.columns = cols.map((col) => ({
    header: col.header,
    key: col.id,
    width: Math.max(col.header.length + 4, 14)
  }))

  // ── Header row styles ─────────────────────────────────────────────────────
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } }
  })
  headerRow.height = 28

  // ── Data rows with zebra striping ─────────────────────────────────────────
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.addRow(row)
    const isEven = rowIndex % 2 === 0
    excelRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' }
      }
      cell.font = { size: 10, name: 'Calibri' }
      cell.alignment = { vertical: 'middle' }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
    })
    excelRow.height = 22
  })

  // ── Auto-fit column widths based on content ───────────────────────────────
  sheet.columns.forEach((column) => {
    if (!column.values) return
    const lengths = column.values
      .filter((v): v is ExcelJS.CellValue => v !== null && v !== undefined)
      .map((v) => String(v).length)
    const maxLen = Math.max(...lengths, String(column.header ?? '').length)
    column.width = Math.min(maxLen + 4, 50)
  })

  // ── Summary formula row ───────────────────────────────────────────────────
  const summaryRow = sheet.addRow([])
  const countCell = summaryRow.getCell(1)
  countCell.value = {
    formula: `COUNTA(A2:A${rows.length + 1})`,
    result: rows.length
  } as ExcelJS.CellFormulaValue
  countCell.font = { bold: true, italic: true, size: 10, color: { argb: 'FF64748B' } }

  // ── Structured Table (enables column filters in Excel) ────────────────────
  sheet.addTable({
    name: 'ExportTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: cols.map((col) => ({ name: col.header, filterButton: true })),
    rows
  })

  // ── Write buffer → download ───────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  downloadBlob(blob, `${options.filename ?? 'export'}.xlsx`)
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

export function importFromCSV(
  file: File,
  onComplete: (data: Record<string, unknown>[]) => void,
  onError: (error: string) => void
): void {
  Papa.parse<Record<string, unknown>>(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => onComplete(results.data),
    error: (err) => onError(err.message)
  })
}

// ─── Excel Import — ExcelJS (resolves formula cached results) ─────────────────

export async function importFromExcel(
  file: File,
  onComplete: (data: Record<string, unknown>[]) => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    const buffer = await file.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const sheet = workbook.worksheets[0]
    if (!sheet) {
      onError('No worksheet found in file')
      return
    }

    const headers: string[] = []
    const data: Record<string, unknown>[] = []

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) {
        row.eachCell((cell) => headers.push(String(cell.value ?? '')))
      } else {
        const record: Record<string, unknown> = {}
        row.eachCell((cell, colIndex) => {
          const key = headers[colIndex - 1]
          if (!key) return
          const val = cell.value
          // Resolve formula cells to their cached result value
          if (val !== null && typeof val === 'object' && 'result' in val) {
            record[key] = (val as ExcelJS.CellFormulaValue).result
          } else {
            record[key] = val
          }
        })
        data.push(record)
      }
    })

    onComplete(data)
  } catch (err) {
    onError(String(err))
  }
}
