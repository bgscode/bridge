import type { GroupRow, StoreRow, FiscalYearRow } from '@shared/index'

export function downloadConnectionTemplate(
  groups: GroupRow[],
  stores: StoreRow[],
  fiscalYears: FiscalYearRow[]
): void {
  const headers = [
    'name',
    'static_ip',
    'vpn_ip',
    'db_name',
    'username',
    'password',
    'trust_cert',
    'group_id',
    'fiscal_year_id',
    'store_id'
  ]
  const sample = [
    'My Connection',
    '192.168.1.100',
    '10.8.0.1',
    'my_database',
    'sa',
    '',
    '1',
    '',
    '',
    ''
  ]

  const csv = [
    '# Connection Bulk Upload Template',
    '# trust_cert: 0=false, 1=true',
    '# group_id, fiscal_year_id, store_id — enter ID or name (case-insensitive)',
    '# If a name does not exist, it will be created automatically',
    '#',
    ...groups.map((g) => `# group_id=${g.id} → ${g.name}`),
    ...stores.map((s) => `# store_id=${s.id} → ${s.name}`),
    ...fiscalYears.map((fy) => `# fiscal_year_id=${fy.id} → ${fy.name}`),
    '#',
    headers.join(','),
    sample.join(',')
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'connection-upload-template.csv'
  }).click()
  URL.revokeObjectURL(url)
}
