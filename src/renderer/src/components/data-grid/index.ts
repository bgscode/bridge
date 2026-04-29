// ─── Main component ───────────────────────────────────────────────────────────
export { DataGrid } from './DataGrid'
export { default } from './DataGrid'

// ─── Sub-components (for custom compositions) ────────────────────────────────
export { DataGridToolbar } from './DataGridToolbar'
export { DataGridHeader } from './DataGridHeader'
export { DataGridBody } from './DataGridBody'
export { DataGridPagination } from './DataGridPagination'
export { DataGridColumnPanel } from './DataGridColumnPanel'
export { DataGridFilters } from './DataGridFilters'

// ─── Hooks ────────────────────────────────────────────────────────────────────
export { useDataGrid } from './hooks/useDataGrid'
export { useColumnState } from './hooks/useColumnState'
export { useColumnResize } from './hooks/useColumnResize'
export { useColumnDnd, useSortableColumn, useDebouncedValue } from './hooks/useColumnDnd'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  DataGridProps,
  DataGridColumnDef,
  DataGridColumnMeta,
  DataGridDensity,
  DataGridColumnState,
  DataGridToolbarOptions,
  DataGridSelectionMode,
  DataGridServerSideProps,
  DataGridFetchParams,
  DataGridPaginationModel,
  FilterModel,
  FilterRule,
  FilterOperator,
  FilterType,
  ExportOptions,
  ExportFormat,
  SortModel
} from './types'

// ─── Utils (for advanced use) ─────────────────────────────────────────────────
export { exportToCSV, exportToExcel, importFromCSV, importFromExcel } from './utils/export.utils'
export {
  applyFilterModel,
  createEmptyFilterModel,
  createEmptyFilterRule,
  FILTER_OPERATOR_LABELS,
  FILTER_OPERATORS_BY_TYPE
} from './utils/filter.utils'
export {
  saveColumnState,
  loadColumnState,
  clearColumnState,
  getPinStyles,
  getPinClassName
} from './utils/column.utils'
