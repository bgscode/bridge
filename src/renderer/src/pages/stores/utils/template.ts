export function downloadStoreTemplate(): void {
  const csv = [
    '# Store Bulk Upload Template',
    '# Required columns: name, code',
    '#',
    '# name (required) — e.g. Main Store',
    '# code (required) — unique store code, e.g. STR-001',
    '#',
    'name,code',
    'Main Store,STR-001',
    'Branch North,STR-002'
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'store-upload-template.csv'
  }).click()
  URL.revokeObjectURL(url)
}
