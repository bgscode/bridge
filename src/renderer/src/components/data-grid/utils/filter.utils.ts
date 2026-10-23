import type {
  DataGridColumnDef,
  FilterModel,
  FilterOperator,
  FilterRule,
  FilterType
} from '../types'

export const FILTER_OPERATORS_BY_TYPE: Record<FilterType, FilterOperator[]> = {
  text: [
    'contains',
    'notContains',
    'equals',
    'notEquals',
    'startsWith',
    'endsWith',
    'isEmpty',
    'isNotEmpty'
  ],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  date: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  boolean: ['is', 'isNot']
}

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'Contains',
  notContains: 'Does not contain',
  equals: 'Equals',
  notEquals: 'Not equals',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty',
  gt: 'Greater than',
  gte: 'Greater than or equal',
  lt: 'Less than',
  lte: 'Less than or equal',
  between: 'Between',
  is: 'Is',
  isNot: 'Is not'
}

function columnIdOf<TData>(col: DataGridColumnDef<TData>): string {
  return col.id ?? ((col as { accessorKey?: string }).accessorKey ?? '')
}

function resolveFilterValue<TData>(
  row: TData,
  columnId: string,
  columns?: DataGridColumnDef<TData>[]
): unknown {
  const col = columns?.find((c) => columnIdOf(c) === columnId)
  if (col) {
    if (typeof col.meta?.getFilterValue === 'function') {
      return col.meta.getFilterValue(row)
    }
    const accessorFn = (col as { accessorFn?: (row: TData, index: number) => unknown }).accessorFn
    if (typeof accessorFn === 'function') {
      return accessorFn(row, 0)
    }
    const accessorKey = (col as { accessorKey?: string }).accessorKey
    if (accessorKey) return (row as Record<string, unknown>)[accessorKey]
  }
  return (row as Record<string, unknown>)[columnId]
}

function asSearchText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

export function applyFilterModel<TData>(
  rows: TData[],
  model: FilterModel,
  columns?: DataGridColumnDef<TData>[]
): TData[] {
  if (!model.rules.length) return rows

  return rows.filter((row) => {
    const results = model.rules.map((rule) => applyRule(row, rule, columns))
    return model.logic === 'and' ? results.every(Boolean) : results.some(Boolean)
  })
}

function applyRule<TData>(
  row: TData,
  rule: FilterRule,
  columns?: DataGridColumnDef<TData>[]
): boolean {
  const cellValue = resolveFilterValue(row, rule.columnId, columns)
  const val = rule.value
  const val2 = rule.value2
  const cellText = asSearchText(cellValue)
  const query = asSearchText(val)

  switch (rule.operator) {
    case 'isEmpty':
      return cellValue === null || cellValue === undefined || cellText === ''
    case 'isNotEmpty':
      return cellValue !== null && cellValue !== undefined && cellText !== ''
    case 'contains':
      if (!query) return true
      return cellText.includes(query)
    case 'notContains':
      if (!query) return true
      return !cellText.includes(query)
    case 'equals':
      return cellText === query
    case 'notEquals':
      return cellText !== query
    case 'startsWith':
      if (!query) return true
      return cellText.startsWith(query)
    case 'endsWith':
      if (!query) return true
      return cellText.endsWith(query)
    case 'gt':
      return Number(cellValue) > Number(val)
    case 'gte':
      return Number(cellValue) >= Number(val)
    case 'lt':
      return Number(cellValue) < Number(val)
    case 'lte':
      return Number(cellValue) <= Number(val)
    case 'between':
      return Number(cellValue) >= Number(val) && Number(cellValue) <= Number(val2 ?? Infinity)
    case 'is':
      if (val === '' || val == null) return true
      return String(cellValue ?? '') === String(val ?? '')
    case 'isNot':
      if (val === '' || val == null) return true
      return String(cellValue ?? '') !== String(val ?? '')
    default:
      return true
  }
}

export function createEmptyFilterRule(columnId: string): FilterRule {
  return {
    id: crypto.randomUUID(),
    columnId,
    operator: 'contains',
    value: ''
  }
}

export function createEmptyFilterModel(): FilterModel {
  return { logic: 'and', rules: [] }
}

