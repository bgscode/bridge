import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCEL_SHEET_LAYOUT, resolveExcelSheetLayout } from '@shared/index'

describe('resolveExcelSheetLayout', () => {
  it('defaults new jobs to Data + connection-wise sheets', () => {
    expect(DEFAULT_EXCEL_SHEET_LAYOUT).toBe('both')
  })

  it('uses a stored layout as-is', () => {
    for (const layout of ['connections', 'combined', 'both'] as const) {
      expect(resolveExcelSheetLayout({ excel_sheet_layout: layout, excel_combine_sheets: 0 })).toBe(
        layout
      )
    }
  })

  it('derives jobs saved before layouts from the combine flag', () => {
    expect(resolveExcelSheetLayout({ excel_sheet_layout: null, excel_combine_sheets: true })).toBe(
      'both'
    )
    expect(resolveExcelSheetLayout({ excel_sheet_layout: null, excel_combine_sheets: 0 })).toBe(
      'connections'
    )
    expect(resolveExcelSheetLayout({ excel_sheet_layout: 'junk', excel_combine_sheets: 1 })).toBe(
      'both'
    )
  })
})
