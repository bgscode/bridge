import type { FilterModel, FilterOperator, FilterRule, FilterType } from '../types'

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

export function applyFilterModel<TData>(rows: TData[], model: FilterModel): TData[] {
  if (!model.rules.length) return rows

  return rows.filter((row) => {
    const results = model.rules.map((rule) => applyRule(row, rule))
    return model.logic === 'and' ? results.every(Boolean) : results.some(Boolean)
  })
}

function applyRule<TData>(row: TData, rule: FilterRule): boolean {
  const cellValue = (row as Record<string, unknown>)[rule.columnId]
  const val = rule.value
  const val2 = rule.value2

  switch (rule.operator) {
    case 'isEmpty':
      return cellValue === null || cellValue === undefined || cellValue === ''
    case 'isNotEmpty':
      return cellValue !== null && cellValue !== undefined && cellValue !== ''
    case 'contains':
      return String(cellValue ?? '')
        .toLowerCase()
        .includes(String(val ?? '').toLowerCase())
    case 'notContains':
      return !String(cellValue ?? '')
        .toLowerCase()
        .includes(String(val ?? '').toLowerCase())
    case 'equals':
      return String(cellValue ?? '') === String(val ?? '')
    case 'notEquals':
      return String(cellValue ?? '') !== String(val ?? '')
    case 'startsWith':
      return String(cellValue ?? '')
        .toLowerCase()
        .startsWith(String(val ?? '').toLowerCase())
    case 'endsWith':
      return String(cellValue ?? '')
        .toLowerCase()
        .endsWith(String(val ?? '').toLowerCase())
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
      return String(cellValue) === String(val)
    case 'isNot':
      return String(cellValue) !== String(val)
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
