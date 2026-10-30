import { describe, expect, it } from 'vitest'
import { formatDateValue, previewDateFormat, validateDateFormat } from '@shared/date-format'

describe('formatDateValue', () => {
  it('keeps the old dd/mm/yyyy output by default', () => {
    expect(formatDateValue('2024-03-15')).toBe('15/03/2024')
    expect(formatDateValue('2024-03-15T00:00:00.000Z')).toBe('15/03/2024')
    expect(formatDateValue(new Date(Date.UTC(2024, 2, 15)))).toBe('15/03/2024')
  })

  it('reads Date objects in UTC so late-night times keep their day', () => {
    expect(formatDateValue(new Date(Date.UTC(2024, 2, 15, 23, 30)), 'dd/mm/yyyy hh:mm')).toBe(
      '15/03/2024 23:30'
    )
  })

  it('treats mm as minutes next to hours or seconds, month otherwise', () => {
    expect(formatDateValue('2024-03-15 14:05:09', 'dd-mm-yyyy hh:mm:ss')).toBe(
      '15-03-2024 14:05:09'
    )
    expect(formatDateValue('2024-03-15 14:05:09', 'MM/dd/yyyy HH:MM')).toBe('03/15/2024 14:05')
  })

  it('supports month names, weekdays, 12-hour time and literal text', () => {
    expect(formatDateValue('2024-03-15 14:05:00', 'ddd, dd-mmm-yy h:mm AM/PM')).toBe(
      'Fri, 15-Mar-24 2:05 PM'
    )
    expect(formatDateValue('2024-03-15', 'dd mmmm yyyy')).toBe('15 March 2024')
    expect(formatDateValue('2024-03-15', '[Date:] yyyy-mm-dd')).toBe('Date: 2024-03-15')
  })

  it('passes through values that are not dates', () => {
    expect(formatDateValue('CN/2026-27/001', 'dd/mm/yyyy')).toBe('CN/2026-27/001')
    expect(formatDateValue(480, 'dd/mm/yyyy')).toBe(480)
    expect(formatDateValue(null, 'dd/mm/yyyy')).toBe(null)
    expect(formatDateValue('2024-13-40', 'dd/mm/yyyy')).toBe('2024-13-40')
  })
})

describe('validateDateFormat', () => {
  it('rejects empty or text-only patterns', () => {
    expect(validateDateFormat('')).not.toBeNull()
    expect(validateDateFormat('[hello]')).not.toBeNull()
    expect(validateDateFormat('dd/mm/yyyy')).toBeNull()
  })
})

describe('previewDateFormat', () => {
  it('renders the sample date', () => {
    expect(previewDateFormat('dd-mmm-yyyy hh:mm AM/PM')).toBe('15-Mar-2024 02:05 PM')
  })
})
