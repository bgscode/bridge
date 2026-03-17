import { useCallback } from 'react'
import type { Table } from '@tanstack/react-table'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { FilterModel, FilterOperator, FilterRule, FilterType } from './types'
import {
  createEmptyFilterRule,
  FILTER_OPERATOR_LABELS,
  FILTER_OPERATORS_BY_TYPE
} from './utils/filter.utils'

interface DataGridFiltersProps<TData> {
  table: Table<TData>
  filterModel: FilterModel
  onFilterModelChange: (model: FilterModel) => void
}

export function DataGridFilters<TData>({
  table,
  filterModel,
  onFilterModelChange
}: DataGridFiltersProps<TData>) {
  const filterableColumns = table
    .getAllLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions' && col.getCanFilter())

  const addRule = useCallback(() => {
    const firstCol = filterableColumns[0]
    if (!firstCol) return
    onFilterModelChange({
      ...filterModel,
      rules: [...filterModel.rules, createEmptyFilterRule(firstCol.id)]
    })
  }, [filterModel, filterableColumns, onFilterModelChange])

  const removeRule = useCallback(
    (ruleId: string) => {
      onFilterModelChange({
        ...filterModel,
        rules: filterModel.rules.filter((r) => r.id !== ruleId)
      })
    },
    [filterModel, onFilterModelChange]
  )

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<FilterRule>) => {
      onFilterModelChange({
        ...filterModel,
        rules: filterModel.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r))
      })
    },
    [filterModel, onFilterModelChange]
  )

  const clearAll = useCallback(() => {
    onFilterModelChange({ logic: filterModel.logic, rules: [] })
  }, [filterModel, onFilterModelChange])

  const getColumnFilterType = (columnId: string): FilterType => {
    const col = table.getColumn(columnId)
    const meta = col?.columnDef.meta as { filterType?: FilterType } | undefined
    return meta?.filterType ?? 'text'
  }

  const getColumnOptions = (columnId: string) => {
    const col = table.getColumn(columnId)
    const meta = col?.columnDef.meta as
      | { filterOptions?: { label: string; value: string }[] }
      | undefined
    return meta?.filterOptions ?? []
  }

  return (
    <div className="flex flex-col gap-3 p-3 border-b bg-muted/20">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Filters
        </span>

        {/* Logic toggle */}
        <div className="flex items-center rounded border overflow-hidden text-xs ml-1">
          {(['and', 'or'] as const).map((logic) => (
            <button
              key={logic}
              type="button"
              onClick={() => onFilterModelChange({ ...filterModel, logic })}
              className={cn(
                'px-2 py-0.5 transition-colors',
                filterModel.logic === logic
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {logic.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {filterModel.rules.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={clearAll}>
              <X className="h-3 w-3 mr-1" />
              Clear all
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={addRule}>
            <Plus className="h-3 w-3 mr-1" />
            Add filter
          </Button>
        </div>
      </div>

      {/* Rules */}
      {filterModel.rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No filters applied. Click <strong>Add filter</strong> to get started.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filterModel.rules.map((rule, index) => {
            const filterType = getColumnFilterType(rule.columnId)
            const operators = FILTER_OPERATORS_BY_TYPE[filterType]
            const selectOptions = getColumnOptions(rule.columnId)
            const needsValue = !['isEmpty', 'isNotEmpty'].includes(rule.operator)
            const needsValue2 = rule.operator === 'between'
            const colLabel = (colId: string) => {
              const col = table.getColumn(colId)
              const h = col?.columnDef.header
              return typeof h === 'string' ? h : colId
            }

            return (
              <li key={rule.id} className="flex flex-wrap items-center gap-2">
                {/* Connector label */}
                <span className="text-xs text-muted-foreground w-6 text-right shrink-0">
                  {index === 0 ? 'Where' : filterModel.logic === 'and' ? 'And' : 'Or'}
                </span>

                {/* Column selector */}
                <Select
                  value={rule.columnId}
                  onValueChange={(v) =>
                    updateRule(rule.id, {
                      columnId: v,
                      operator: FILTER_OPERATORS_BY_TYPE[getColumnFilterType(v)][0],
                      value: ''
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue>{colLabel(rule.columnId)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filterableColumns.map((col) => (
                      <SelectItem key={col.id} value={col.id} className="text-xs">
                        {colLabel(col.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Operator selector */}
                <Select
                  value={rule.operator}
                  onValueChange={(v) => updateRule(rule.id, { operator: v as FilterOperator })}
                >
                  <SelectTrigger className="h-7 w-40 text-xs">
                    <SelectValue>{FILTER_OPERATOR_LABELS[rule.operator]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op} value={op} className="text-xs">
                        {FILTER_OPERATOR_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value input */}
                {needsValue &&
                  (filterType === 'select' ? (
                    <Select
                      value={String(rule.value ?? '')}
                      onValueChange={(v) => updateRule(rule.id, { value: v })}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={String(rule.value ?? '')}
                      onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                      placeholder="Value…"
                      type={
                        filterType === 'number' ? 'number' : filterType === 'date' ? 'date' : 'text'
                      }
                      className="h-7 w-36 text-xs"
                    />
                  ))}

                {/* Value2 for between */}
                {needsValue2 && (
                  <Input
                    value={String(rule.value2 ?? '')}
                    onChange={(e) => updateRule(rule.id, { value2: e.target.value })}
                    placeholder="And…"
                    type={filterType === 'number' ? 'number' : 'text'}
                    className="h-7 w-28 text-xs"
                  />
                )}

                {/* Remove rule */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRule(rule.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
