import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  VisibilityState as ColumnVisibilityState,
  OnChangeFn,
  PaginationState,
  Row,
  RowSelectionState,
  SortingState,
  Table
} from '@tanstack/react-table'
import type React from 'react'

// ─── Density / UI Variant ─────────────────────────────────────────────────────
export type DataGridDensity = 'compact' | 'standard' | 'comfortable'

// ─── Filter Types ─────────────────────────────────────────────────────────────
export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'is'
  | 'isNot'

export type FilterType = 'text' | 'number' | 'date' | 'select' | 'boolean'

export interface FilterRule {
  id: string
  columnId: string
  operator: FilterOperator
  value: string | number | boolean | null
  value2?: string | number | null // for 'between'
}

export interface FilterModel {
  logic: 'and' | 'or'
  rules: FilterRule[]
}

// ─── Column Extension ─────────────────────────────────────────────────────────
export interface DataGridColumnMeta {
  filterType?: FilterType
  filterOptions?: { label: string; value: string }[] // for 'select' filter
  pinnable?: boolean
  resizable?: boolean
  reorderable?: boolean
  align?: 'left' | 'center' | 'right'
  headerGroup?: string // for grouped headers
}

export type DataGridColumnDef<TData> = ColumnDef<TData, unknown> & {
  meta?: DataGridColumnMeta
}

// ─── Sort Model ───────────────────────────────────────────────────────────────
export interface SortModel {
  field: string
  sort: 'asc' | 'desc'
}

// ─── Pagination Model ─────────────────────────────────────────────────────────
export interface DataGridPaginationModel {
  page: number
  pageSize: number
}

// ─── Server-side props ────────────────────────────────────────────────────────
export interface DataGridServerSideProps<TData> {
  rowCount: number
  onFetchRows: (params: DataGridFetchParams) => Promise<TData[]> | void
}

export interface DataGridFetchParams {
  page: number
  pageSize: number
  sorting: SortModel[]
  filters: FilterModel
  globalFilter: string
}

// ─── Selection ────────────────────────────────────────────────────────────────
export type DataGridSelectionMode = 'single' | 'multiple' | 'none'

// ─── Column State (persisted) ─────────────────────────────────────────────────
export interface DataGridColumnState {
  visibility: ColumnVisibilityState
  order: ColumnOrderState
  sizing: ColumnSizingState
  pinning: ColumnPinningState
  sorting: SortingState
  filters: ColumnFiltersState
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────
export interface DataGridToolbarOptions {
  showSearch?: boolean
  showColumnToggle?: boolean
  showExport?: boolean
  showImport?: boolean
  showDensityToggle?: boolean
  showFilterPanel?: boolean
  customActions?: React.ReactNode
}

// ─── Export ──────────────────────────────────────────────────────────────────
export type ExportFormat = 'csv' | 'excel'

export interface ExportOptions {
  format: ExportFormat
  filename?: string
  selectedOnly?: boolean
}

// ─── Main DataGrid Props ──────────────────────────────────────────────────────
export interface DataGridProps<TData> {
  // Data
  data: TData[]
  columns: DataGridColumnDef<TData>[]

  // Server-side
  serverSide?: DataGridServerSideProps<TData>

  // Row key
  getRowId?: (row: TData) => string

  // Sorting
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  enableMultiSort?: boolean

  // Filtering
  filterModel?: FilterModel
  onFilterModelChange?: (model: FilterModel) => void
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  filterDebounceMs?: number

  // Pagination
  pagination?: PaginationState
  onPaginationChange?: OnChangeFn<PaginationState>
  pageSizeOptions?: number[]
  rowCount?: number // for server-side
  hidePagination?: boolean

  // Selection
  selectionMode?: DataGridSelectionMode
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  onRowClick?: (row: Row<TData>) => void

  // Column features
  enableColumnResizing?: boolean
  enableColumnReordering?: boolean
  enableColumnPinning?: boolean
  enableColumnHiding?: boolean

  // Virtualization
  enableVirtualization?: boolean
  estimatedRowHeight?: number

  // Density
  density?: DataGridDensity
  onDensityChange?: (density: DataGridDensity) => void

  // Toolbar
  toolbar?: DataGridToolbarOptions | false

  // Import — called after file is parsed; rows = parsed CSV/Excel rows
  // Use this to upload data to your server, validate, etc.
  onImport?: (rows: Record<string, unknown>[], file: File) => void | Promise<void>

  // Export — override the default local export behaviour.
  // format = 'csv' | 'excel', rows = data to export (already filtered/selected),
  // selectedOnly = true when user chose "Export selected".
  // If not provided, the built-in browser-side CSV/Excel download is used.
  onExport?: (
    format: ExportFormat,
    rows: Record<string, unknown>[],
    selectedOnly: boolean
  ) => void | Promise<void>

  // State persistence
  persistStateKey?: string

  // Styling
  className?: string
  height?: number | string

  // Loading
  loading?: boolean

  // Empty state
  emptyMessage?: string

  // Custom renderers
  renderToolbar?: (table: Table<TData>) => React.ReactNode
  renderEmptyState?: () => React.ReactNode
}
