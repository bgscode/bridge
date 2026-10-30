import { JSX, useMemo, useState } from 'react'
import type { Column } from '@tanstack/react-table'
import { ArrowDownAZ, ArrowUpAZ, Filter, FilterX, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { DataGridColumnMeta, FilterOperator, FilterRule, FilterType } from './types'
import type { ColumnFilterInput } from './hooks/useDataGrid'
import { FILTER_OPERATOR_LABELS, FILTER_OPERATORS_BY_TYPE } from './utils/filter.utils'

/** Rendering thousands of checkboxes freezes the popup; search narrows the rest. */
const MAX_LISTED_VALUES = 1000
const NO_CONDITION = '__none__'

interface DataGridColumnFilterProps {
  column: Column<unknown, unknown>
  /** Current rule for this column, if any. */
  rule: FilterRule | undefined
  getValues: () => string[]
  onApply: (filter: ColumnFilterInput | null) => void
}

/** Excel-style column filter: sort, condition filter and a value checklist. */
export function DataGridColumnFilter({
  column,
  rule,
  getValues,
  onApply
}: DataGridColumnFilterProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = !!rule

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={active ? 'Filter applied' : 'Filter'}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            active
              ? 'text-primary bg-primary/10 hover:bg-primary/20'
              : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted'
          )}
        >
          <Filter className={cn('h-3 w-3', active && 'fill-current')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 gap-2" onClick={(e) => e.stopPropagation()}>
        {open && (
          <FilterBody
            column={column}
            rule={rule}
            values={getValues()}
            onApply={(f) => {
              onApply(f)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function FilterBody({
  column,
  rule,
  values,
  onApply,
  onClose
}: {
  column: Column<unknown, unknown>
  rule: FilterRule | undefined
  values: string[]
  onApply: (filter: ColumnFilterInput | null) => void
  onClose: () => void
}): JSX.Element {
  const meta = column.columnDef.meta as DataGridColumnMeta | undefined
  const filterType: FilterType = meta?.filterType ?? 'text'
  const operators = FILTER_OPERATORS_BY_TYPE[filterType]

  const labelOf = useMemo(() => {
    const options = new Map((meta?.filterOptions ?? []).map((o) => [o.value, o.label]))
    return (key: string): string => (key === '' ? '(Blanks)' : (options.get(key) ?? key))
  }, [meta?.filterOptions])

  // Values hidden by an existing value filter still appear (unchecked).
  const allValues = useMemo(() => {
    if (rule?.operator !== 'in' || !rule.values) return values
    const known = new Set(values)
    return [...values, ...rule.values.filter((v) => !known.has(v))]
  }, [values, rule])

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(rule?.operator === 'in' ? (rule.values ?? []) : allValues)
  )
  const [search, setSearch] = useState('')
  const [condOp, setCondOp] = useState<FilterOperator | typeof NO_CONDITION>(
    rule && rule.operator !== 'in' ? rule.operator : NO_CONDITION
  )
  const [condValue, setCondValue] = useState(
    rule && rule.operator !== 'in' ? String(rule.value ?? '') : ''
  )
  const [condValue2, setCondValue2] = useState(
    rule && rule.operator !== 'in' ? String(rule.value2 ?? '') : ''
  )

  const query = search.trim().toLowerCase()
  const visible = useMemo(
    () => (query ? allValues.filter((v) => labelOf(v).toLowerCase().includes(query)) : allValues),
    [allValues, query, labelOf]
  )
  const listed = visible.slice(0, MAX_LISTED_VALUES)
  const visibleChecked = visible.filter((v) => checked.has(v)).length
  const allVisibleChecked = visible.length > 0 && visibleChecked === visible.length

  const usingCondition = condOp !== NO_CONDITION
  const condNeedsValue = usingCondition && !['isEmpty', 'isNotEmpty'].includes(condOp)
  const condNeedsValue2 = condOp === 'between'
  const inputType = filterType === 'number' ? 'number' : filterType === 'date' ? 'date' : 'text'

  function toggleAllVisible(next: boolean): void {
    setChecked((prev) => {
      const s = new Set(prev)
      for (const v of visible) {
        if (next) s.add(v)
        else s.delete(v)
      }
      return s
    })
  }

  function toggleValue(v: string, next: boolean): void {
    setChecked((prev) => {
      const s = new Set(prev)
      if (next) s.add(v)
      else s.delete(v)
      return s
    })
  }

  // With a search term, Excel keeps only the checked values that match it.
  const selection = query ? visible.filter((v) => checked.has(v)) : [...checked]
  const canApply = usingCondition
    ? !condNeedsValue || condValue.trim() !== ''
    : selection.length > 0

  function apply(): void {
    if (usingCondition) {
      onApply({
        operator: condOp,
        value: condValue,
        value2: condNeedsValue2 ? condValue2 : undefined
      })
      return
    }
    const everything = !query && allValues.every((v) => checked.has(v))
    onApply(everything ? null : { operator: 'in', value: null, values: selection })
  }

  function sort(desc: boolean): void {
    column.toggleSorting(desc, false)
    onClose()
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      {column.getCanSort() && (
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => sort(false)}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted text-left"
          >
            <ArrowDownAZ className="h-3.5 w-3.5" />
            Sort A to Z
          </button>
          <button
            type="button"
            onClick={() => sort(true)}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted text-left"
          >
            <ArrowUpAZ className="h-3.5 w-3.5" />
            Sort Z to A
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={!rule}
        onClick={() => onApply(null)}
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted text-left disabled:opacity-40 disabled:pointer-events-none"
      >
        <FilterX className="h-3.5 w-3.5" />
        Clear filter
      </button>

      <div className="border-t pt-2 flex flex-col gap-1.5">
        <span className="font-medium text-muted-foreground">
          {filterType === 'number' ? 'Number' : filterType === 'date' ? 'Date' : 'Text'} filter
        </span>
        <Select value={condOp} onValueChange={(v) => setCondOp(v as FilterOperator)}>
          <SelectTrigger className="h-7 w-full text-xs">
            <SelectValue>
              {usingCondition ? FILTER_OPERATOR_LABELS[condOp] : 'None (use list below)'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONDITION} className="text-xs">
              None (use list below)
            </SelectItem>
            {operators.map((op) => (
              <SelectItem key={op} value={op} className="text-xs">
                {FILTER_OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {condNeedsValue && (
          <div className="flex gap-1.5">
            <Input
              autoFocus
              value={condValue}
              onChange={(e) => setCondValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canApply && apply()}
              placeholder="Value…"
              type={inputType}
              className="h-7 text-xs"
            />
            {condNeedsValue2 && (
              <Input
                value={condValue2}
                onChange={(e) => setCondValue2(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canApply && apply()}
                placeholder="And…"
                type={inputType}
                className="h-7 text-xs"
              />
            )}
          </div>
        )}
      </div>

      <div
        className={cn(
          'border-t pt-2 flex flex-col gap-1.5',
          usingCondition && 'opacity-40 pointer-events-none'
        )}
      >
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canApply && apply()}
            placeholder="Search"
            className="h-7 pl-7 text-xs"
          />
        </div>

        <div className="max-h-56 overflow-y-auto rounded border py-1">
          <label className="flex items-center gap-2 px-2 py-1 hover:bg-muted cursor-pointer font-medium">
            <Checkbox
              checked={allVisibleChecked ? true : visibleChecked > 0 ? 'indeterminate' : false}
              onCheckedChange={(c) => toggleAllVisible(c === true)}
            />
            {query ? '(Select All Search Results)' : '(Select All)'}
          </label>
          {listed.map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 px-2 py-1 hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={checked.has(v)}
                onCheckedChange={(c) => toggleValue(v, c === true)}
              />
              <span className={cn('truncate', v === '' && 'italic text-muted-foreground')}>
                {labelOf(v)}
              </span>
            </label>
          ))}
          {visible.length === 0 && <p className="px-2 py-1 text-muted-foreground">No matches</p>}
          {visible.length > MAX_LISTED_VALUES && (
            <p className="px-2 py-1 text-muted-foreground">
              Showing {MAX_LISTED_VALUES.toLocaleString()} of {visible.length.toLocaleString()} —
              search to narrow down
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-1.5 border-t pt-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" disabled={!canApply} onClick={apply}>
          OK
        </Button>
      </div>
    </div>
  )
}
