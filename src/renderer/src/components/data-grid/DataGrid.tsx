import { useState, useCallback, useEffect, useRef, JSX } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { useDataGrid } from './hooks/useDataGrid'
import { DataGridToolbar } from './DataGridToolbar'
import { DataGridHeader } from './DataGridHeader'
import { DataGridBody } from './DataGridBody'
import { DataGridPagination } from './DataGridPagination'
import { DataGridColumnPanel } from './DataGridColumnPanel'
import { DataGridFilters } from './DataGridFilters'
import { importFromCSV, importFromExcel } from './utils/export.utils'

import type { DataGridProps } from './types'

export function DataGrid<TData>(props: DataGridProps<TData>): JSX.Element {
  const {
    enableColumnReordering = true,
    enableColumnPinning = true,
    enableColumnResizing = true,
    enableColumnHiding = true,
    enableVirtualization = false,
    estimatedRowHeight,
    selectionMode = 'none',
    hidePagination = false,
    pageSizeOptions = [10, 20, 50, 100],
    className,
    height,
    loading = false,
    emptyMessage,
    renderEmptyState,
    renderToolbar,
    toolbar,
    persistStateKey
  } = props

  const {
    table,
    globalFilter,
    setGlobalFilter,
    filterModel,
    setFilterModel,
    density,
    setDensity,
    resetColumnState
  } = useDataGrid(props)

  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [columnPanelOpen, setColumnPanelOpen] = useState(false)
  const columnPanelRef = useRef<HTMLDivElement>(null)
  const columnPanelButtonRef = useRef<HTMLButtonElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // ── Server-side fetch trigger ─────────────────────────────────────────────
  const { sorting, pagination } = table.getState()
  useEffect(() => {
    if (!props.serverSide) return
    props.serverSide.onFetchRows({
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sorting: sorting.map((s) => ({ field: s.id, sort: s.desc ? 'desc' : 'asc' })),
      filters: filterModel,
      globalFilter
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, pagination, filterModel, globalFilter])

  // ── Import handler ─────────────────────────────────────────────────────────
  const handleImport = useCallback(
    (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'csv') {
        importFromCSV(
          file,
          (data) => {
            if (props.onImport) {
              void Promise.resolve(props.onImport(data, file))
            } else {
              console.info('[DataGrid] imported', data.length, 'rows')
            }
          },
          (err) => console.error('[DataGrid] import error:', err)
        )
      } else {
        importFromExcel(
          file,
          (data) => {
            if (props.onImport) {
              void Promise.resolve(props.onImport(data, file))
            } else {
              console.info('[DataGrid] imported', data.length, 'rows')
            }
          },
          (err) => console.error('[DataGrid] import error:', err)
        ).catch(console.error)
      }
    },
    [props.onImport]
  )

  // ── Keyboard nav: Escape closes panels ────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setFilterPanelOpen(false)
        setColumnPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Outside-click: close column panel ─────────────────────────────────────
  useEffect(() => {
    if (!columnPanelOpen) return
    function onPointerDown(e: PointerEvent): void {
      if (
        columnPanelRef.current &&
        !columnPanelRef.current.contains(e.target as Node) &&
        columnPanelButtonRef.current &&
        !columnPanelButtonRef.current.contains(e.target as Node)
      ) {
        setColumnPanelOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [columnPanelOpen])

  const toolbarOptions =
    toolbar === false
      ? false
      : {
          showSearch: true,
          showColumnToggle: true,
          showExport: true,
          showImport: false,
          showDensityToggle: true,
          showFilterPanel: true,
          ...toolbar
        }

  const selectedCount = Object.keys(table.getState().rowSelection).length

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-col rounded-md border bg-card text-card-foreground overflow-hidden',
          !height && 'flex-1',
          className
        )}
        style={height ? { height } : undefined}
        role="grid"
        aria-rowcount={table.getFilteredRowModel().rows.length}
        aria-colcount={table.getVisibleLeafColumns().length}
      >
        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        {toolbarOptions !== false && (
          <>
            {renderToolbar ? (
              renderToolbar(table)
            ) : (
              <div className="relative flex items-center w-full">
                <DataGridToolbar
                  table={table}
                  globalFilter={globalFilter}
                  onGlobalFilterChange={setGlobalFilter}
                  density={density}
                  onDensityChange={setDensity}
                  onFilterPanelToggle={() => setFilterPanelOpen((p) => !p)}
                  onColumnPanelToggle={() => setColumnPanelOpen((p) => !p)}
                  onImport={toolbarOptions.showImport ? handleImport : undefined}
                  onExport={props.onExport}
                  options={toolbarOptions}
                  exportFilename={persistStateKey ?? 'export'}
                  filterPanelOpen={filterPanelOpen}
                  columnPanelOpen={columnPanelOpen}
                  selectedCount={selectedCount}
                  columnPanelButtonRef={columnPanelButtonRef}
                />

                {/* Column panel popover — anchored to right side of toolbar */}
                {columnPanelOpen && enableColumnHiding && (
                  <div
                    ref={columnPanelRef}
                    className="absolute right-2 top-full z-50 mt-1 rounded-md border bg-popover shadow-lg"
                  >
                    <DataGridColumnPanel table={table} onReset={resetColumnState} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Advanced Filters ─────────────────────────────────────────────── */}
        {filterPanelOpen && (
          <DataGridFilters
            table={table}
            filterModel={filterModel}
            onFilterModelChange={setFilterModel}
          />
        )}

        {/* ── Table area ───────────────────────────────────────────────────── */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto relative"
          style={enableVirtualization ? { willChange: 'scroll-position' } : undefined}
        >
          <table
            className="w-full border-collapse"
            style={{ tableLayout: 'fixed', minWidth: 'max-content' }}
            role="grid"
          >
            <DataGridHeader
              table={table}
              density={density}
              enableColumnReordering={enableColumnReordering}
              enableColumnPinning={enableColumnPinning}
              enableColumnResizing={enableColumnResizing}
              selectionMode={selectionMode}
              enableVirtualization={enableVirtualization}
            />
            <DataGridBody
              table={table}
              density={density}
              enableVirtualization={enableVirtualization}
              estimatedRowHeight={estimatedRowHeight}
              selectionMode={selectionMode}
              onRowClick={props.onRowClick}
              loading={loading}
              emptyMessage={emptyMessage}
              renderEmptyState={renderEmptyState}
              scrollContainerRef={scrollContainerRef}
            />
          </table>
        </div>

        {/* ── Pagination ───────────────────────────────────────────────────── */}
        {!hidePagination && !enableVirtualization && (
          <DataGridPagination
            table={table}
            pageSizeOptions={pageSizeOptions}
            serverSide={!!props.serverSide}
            rowCount={props.rowCount ?? props.serverSide?.rowCount}
          />
        )}

        {/* ── Row count footer for virtualized mode ────────────────────────── */}
        {enableVirtualization && (
          <div className="flex items-center justify-between gap-4 px-3 py-2 border-t text-sm">
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {(() => {
                const selectedCount = Object.keys(table.getState().rowSelection).length
                const totalRows = table.getPrePaginationRowModel().rows.length
                return selectedCount > 0
                  ? `${selectedCount} of ${totalRows} selected`
                  : `${totalRows} row${totalRows !== 1 ? 's' : ''}`
              })()}
            </span>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

export default DataGrid
