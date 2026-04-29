import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type VisibilityState as ColumnVisibilityState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Table
} from '@tanstack/react-table'
import type { DataGridColumnDef, DataGridProps, FilterModel } from '../types'
import { clearColumnState, loadColumnState, saveColumnState } from '../utils/column.utils'
import { applyFilterModel, createEmptyFilterModel } from '../utils/filter.utils'

export interface UseDataGridReturn<TData> {
  table: Table<TData>
  globalFilter: string
  setGlobalFilter: (v: string) => void
  filterModel: FilterModel
  setFilterModel: (m: FilterModel) => void
  density: 'compact' | 'standard' | 'comfortable'
  setDensity: (d: 'compact' | 'standard' | 'comfortable') => void
  resetColumnState: () => void
}

export function useDataGrid<TData>(props: DataGridProps<TData>): UseDataGridReturn<TData> {
  const {
    data,
    columns,
    persistStateKey,
    enableColumnResizing = true,
    enableColumnReordering = true,
    enableColumnPinning = true,
    enableColumnHiding = true,
    enableMultiSort = true,
    filterDebounceMs: _filterDebounceMs = 300
  } = props

  // ── Load persisted state ────────────────────────────────────────────────
  const persisted = useMemo(
    () => (persistStateKey ? loadColumnState(persistStateKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // ── Controlled / uncontrolled sorting ───────────────────────────────────
  const [internalSorting, setInternalSorting] = useState<SortingState>(
    props.sorting ?? persisted?.sorting ?? []
  )
  const sorting = props.sorting ?? internalSorting
  const onSortingChange = props.onSortingChange ?? setInternalSorting

  // ── Pagination ──────────────────────────────────────────────────────────
  const [internalPagination, setInternalPagination] = useState<PaginationState>(
    props.pagination ?? { pageIndex: 0, pageSize: props.pageSizeOptions?.[0] ?? 20 }
  )
  const pagination = props.pagination ?? internalPagination
  const onPaginationChange = props.onPaginationChange ?? setInternalPagination

  // ── Row selection ───────────────────────────────────────────────────────
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>(
    props.rowSelection ?? {}
  )
  const rowSelection = props.rowSelection ?? internalRowSelection
  const onRowSelectionChange = props.onRowSelectionChange ?? setInternalRowSelection

  // ── Column visibility ───────────────────────────────────────────────────
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    persisted?.visibility ?? {}
  )

  // ── Column order ────────────────────────────────────────────────────────
  // Ensure 'actions' column is always last in the order.
  const hasActions = columns.some((c) => c.id === 'actions')
  const hasSelect = !!props.selectionMode && props.selectionMode !== 'none'

  // Build a full column ID list from definitions (includes select if needed)
  const allColumnIds = useMemo(() => {
    const ids = columns
      .map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey ?? '')
      .filter(Boolean)
    return hasSelect ? ['select', ...ids] : ids
  }, [columns, hasSelect])

  const buildColumnOrder = useCallback(
    (order: ColumnOrderState): ColumnOrderState => {
      if (!hasActions) return order

      // Start from the saved order or the full column list
      const base = order.length > 0 ? order : [...allColumnIds]

      // Merge: keep saved order, then append any NEW columns that aren't in the saved list
      const baseSet = new Set(base)
      const missing = allColumnIds.filter((id) => !baseSet.has(id))
      const merged = [...base, ...missing]

      // Remove 'actions' from wherever it is and push it to the very end
      const filtered = merged.filter((id) => id !== 'actions')
      return [...filtered, 'actions']
    },
    [hasActions, allColumnIds]
  )

  const [columnOrder, _setColumnOrder] = useState<ColumnOrderState>(() =>
    buildColumnOrder(persisted?.order ?? [])
  )

  // Enforce 'actions' last after mount / HMR / column changes
  useEffect(() => {
    if (!hasActions) return
    _setColumnOrder((prev) => {
      const fixed = buildColumnOrder(prev)
      // Only update if the order actually changed (avoid infinite loops)
      if (JSON.stringify(prev) === JSON.stringify(fixed)) return prev
      return fixed
    })
  }, [hasActions, buildColumnOrder])

  const setColumnOrder = useCallback(
    (updater: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)) => {
      _setColumnOrder((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        return buildColumnOrder(next)
      })
    },
    [buildColumnOrder]
  )

  // ── Column sizing ────────────────────────────────────────────────────────
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(persisted?.sizing ?? {})

  // ── Column pinning ───────────────────────────────────────────────────────
  // Select column is always pinned left; merge with any persisted pinning.
  const defaultPinning = useMemo<ColumnPinningState>(
    () =>
      props.selectionMode && props.selectionMode !== 'none' ? { left: ['select'], right: [] } : {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(() => {
    const saved = persisted?.pinning
    if (!saved) return defaultPinning
    // Ensure 'select' is always in the left pin list even if not in persisted state
    const leftPins = saved.left ?? []
    const hasSelect = leftPins.includes('select')
    return props.selectionMode && props.selectionMode !== 'none'
      ? { ...saved, left: hasSelect ? leftPins : ['select', ...leftPins] }
      : saved
  })

  // ── Column filters ───────────────────────────────────────────────────────
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(persisted?.filters ?? [])

  // ── Global filter ────────────────────────────────────────────────────────
  const [internalGlobalFilter, setInternalGlobalFilter] = useState(props.globalFilter ?? '')
  const globalFilter = props.globalFilter ?? internalGlobalFilter
  const setGlobalFilter = props.onGlobalFilterChange ?? setInternalGlobalFilter

  // ── Advanced filter model ────────────────────────────────────────────────
  const [internalFilterModel, setInternalFilterModel] = useState<FilterModel>(
    props.filterModel ?? createEmptyFilterModel()
  )
  const filterModel = props.filterModel ?? internalFilterModel
  const setFilterModel = props.onFilterModelChange ?? setInternalFilterModel

  // ── Density ──────────────────────────────────────────────────────────────
  const [density, setDensityState] = useState<'compact' | 'standard' | 'comfortable'>(
    props.density ?? 'standard'
  )
  const setDensity = useCallback(
    (d: 'compact' | 'standard' | 'comfortable') => {
      setDensityState(d)
      props.onDensityChange?.(d)
    },
    [props]
  )

  // ── Build columns — select col injected here, rendered in DataGridBody ───
  const tableColumns = useMemo<DataGridColumnDef<TData>[]>(() => {
    if (props.selectionMode === 'none' || !props.selectionMode) return columns
    const selectCol: DataGridColumnDef<TData> = {
      id: 'select',
      size: 40,
      enableSorting: false,
      enableResizing: false,
      enableHiding: false,
      // header/cell rendering is handled by DataGridHeader/DataGridBody
      header: () => null,
      cell: () => null
    }
    return [selectCol, ...columns]
  }, [columns, props.selectionMode])

  // ── TanStack Table instance ───────────────────────────────────────────────
  // For local mode: apply the advanced filterModel on top of raw data.
  // For server-side: data is already filtered by the server, skip.
  const filteredData = useMemo<TData[]>(() => {
    if (props.serverSide) return data
    if (!filterModel.rules.length) return data
    return applyFilterModel(data, filterModel)
  }, [data, filterModel, props.serverSide])

  const table = useReactTable<TData>({
    data: filteredData,
    columns: tableColumns,
    state: {
      sorting,
      pagination,
      rowSelection,
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning,
      columnFilters,
      globalFilter
    },
    enableMultiSort,
    enableColumnResizing,
    columnResizeMode: 'onChange',
    enableRowSelection: props.selectionMode !== 'none',
    enableMultiRowSelection: props.selectionMode === 'multiple',
    getRowId: props.getRowId,
    manualSorting: !!props.serverSide,
    manualPagination: !!props.serverSide,
    manualFiltering: !!props.serverSide,
    rowCount: props.rowCount ?? props.serverSide?.rowCount,
    onSortingChange,
    onPaginationChange,
    onRowSelectionChange,
    onColumnVisibilityChange: enableColumnHiding ? setColumnVisibility : undefined,
    onColumnOrderChange: enableColumnReordering ? setColumnOrder : undefined,
    onColumnSizingChange: enableColumnResizing ? setColumnSizing : undefined,
    onColumnPinningChange: enableColumnPinning ? setColumnPinning : undefined,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  })

  // ── Persist state to localStorage ────────────────────────────────────────
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!persistStateKey) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      saveColumnState(persistStateKey, {
        visibility: columnVisibility,
        order: columnOrder,
        sizing: columnSizing,
        pinning: columnPinning,
        sorting,
        filters: columnFilters
      })
    }, 500)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [
    columnVisibility,
    columnOrder,
    columnSizing,
    columnPinning,
    sorting,
    columnFilters,
    persistStateKey
  ])

  // ── Reset column state ────────────────────────────────────────────────────
  const resetColumnState = useCallback(() => {
    setColumnVisibility({})
    setColumnOrder([])
    setColumnSizing({})
    setColumnPinning(defaultPinning)
    setInternalSorting([])
    setColumnFilters([])
    if (persistStateKey) clearColumnState(persistStateKey)
  }, [persistStateKey, defaultPinning, setColumnOrder])

  return {
    table,
    globalFilter,
    setGlobalFilter,
    filterModel,
    setFilterModel,
    density,
    setDensity,
    resetColumnState
  }
}
