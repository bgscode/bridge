import { useState, useRef, useCallback } from 'react'
import type { Table } from '@tanstack/react-table'
import { Search, X, Download, Upload, Columns3, SlidersHorizontal, Rows3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DataGridDensity, DataGridToolbarOptions, ExportOptions } from './types'
import { exportToCSV, exportToExcel } from './utils/export.utils'
import type { ExportFormat } from './types'

interface DataGridToolbarProps<TData> {
  table: Table<TData>
  globalFilter: string
  onGlobalFilterChange: (v: string) => void
  density: DataGridDensity
  onDensityChange: (d: DataGridDensity) => void
  onFilterPanelToggle: () => void
  onColumnPanelToggle: () => void
  onImport?: (file: File) => void
  onExport?: (
    format: ExportFormat,
    rows: Record<string, unknown>[],
    selectedOnly: boolean
  ) => void | Promise<void>
  options: DataGridToolbarOptions
  exportFilename?: string
  filterPanelOpen: boolean
  columnPanelOpen: boolean
  selectedCount: number
  columnPanelButtonRef?: React.RefObject<HTMLButtonElement | null>
}

const DENSITY_OPTIONS: { value: DataGridDensity; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'comfortable', label: 'Comfortable' }
]

export function DataGridToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  density,
  onDensityChange,
  onFilterPanelToggle,
  onColumnPanelToggle,
  onImport,
  onExport,
  options,
  exportFilename = 'export',
  filterPanelOpen,
  columnPanelOpen,
  selectedCount,
  columnPanelButtonRef
}: DataGridToolbarProps<TData>) {
  const importRef = useRef<HTMLInputElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = useCallback(
    async (format: 'csv' | 'excel', selectedOnly = false) => {
      setIsExporting(true)
      try {
        if (onExport) {
          // Custom export — caller handles server upload / file generation
          const rows = selectedOnly
            ? table.getSelectedRowModel().rows.map((r) => r.original as Record<string, unknown>)
            : table.getFilteredRowModel().rows.map((r) => r.original as Record<string, unknown>)
          await Promise.resolve(onExport(format, rows, selectedOnly))
        } else {
          // Default local browser-side export
          const opts: ExportOptions = { format, filename: exportFilename, selectedOnly }
          if (format === 'csv') {
            exportToCSV(table, opts)
          } else {
            await exportToExcel(table, opts)
          }
        }
      } finally {
        setIsExporting(false)
      }
    },
    [table, exportFilename, onExport]
  )

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onImport?.(file)
      e.target.value = ''
    },
    [onImport]
  )

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b w-full">
      {/* Left — search */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {options.showSearch !== false && (
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={globalFilter}
              onChange={(e) => onGlobalFilterChange(e.target.value)}
              placeholder="Search…"
              className="pl-8 h-8 text-sm"
            />
            {globalFilter && (
              <button
                onClick={() => onGlobalFilterChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {selectedCount} selected
          </span>
        )}

        {/* Custom actions slot */}
        {options.customActions}
      </div>

      {/* Right — action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Advanced Filter Toggle */}
        {options.showFilterPanel !== false && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={filterPanelOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={onFilterPanelToggle}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Advanced Filters</TooltipContent>
          </Tooltip>
        )}

        {/* Column Panel Toggle */}
        {options.showColumnToggle !== false && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={columnPanelButtonRef}
                variant={columnPanelOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={onColumnPanelToggle}
              >
                <Columns3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Manage Columns</TooltipContent>
          </Tooltip>
        )}

        {/* Density Toggle */}
        {options.showDensityToggle !== false && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Rows3 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Row Density</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {DENSITY_OPTIONS.map((d) => (
                <DropdownMenuItem
                  key={d.value}
                  onClick={() => onDensityChange(d.value)}
                  className={cn(density === d.value && 'font-semibold bg-accent')}
                >
                  {d.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Import */}
        {options.showImport && onImport && (
          <>
            <input
              ref={importRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => importRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import CSV / Excel</TooltipContent>
            </Tooltip>
          </>
        )}

        {/* Export */}
        {options.showExport !== false && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isExporting}>
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('excel')}>
                Export as Excel (.xlsx)
              </DropdownMenuItem>
              {selectedCount > 0 && (
                <>
                  <DropdownMenuItem onClick={() => handleExport('csv', true)}>
                    Export selected as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('excel', true)}>
                    Export selected as Excel
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
