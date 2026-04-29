export function downloadGroupTemplate(): void {
  const csv = [
    '# Group Bulk Upload Template',
    '# Required columns: name',
    '# Optional columns: description',
    '#',
    '# name (required) — e.g. Head Office',
    '# description (optional) — short description',
    '#',
    'name,description',
    'Head Office,Main headquarters',
    'Branch North,'
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'group-upload-template.csv'
  }).click()
  URL.revokeObjectURL(url)
}
