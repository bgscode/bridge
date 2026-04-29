export function downloadFiscalYearTemplate(): void {
  const csv = [
    '# Fiscal Year Bulk Upload Template',
    '# Required columns: name',
    '#',
    '# name (required) — e.g. 2025-26',
    '#',
    'name',
    '2025-26',
    '2026-27'
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'fiscal-year-upload-template.csv'
  }).click()
  URL.revokeObjectURL(url)
}
