import type { Table } from '@tanstack/react-table'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface DataGridPaginationProps<TData> {
  table: Table<TData>
  pageSizeOptions?: number[]
  serverSide?: boolean
  rowCount?: number
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100]

export function DataGridPagination<TData>({
  table,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  rowCount
}: DataGridPaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination
  const totalRows = rowCount ?? table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const from = pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, totalRows)
  const selectedCount = Object.keys(table.getState().rowSelection).length

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2 border-t text-sm">
      {/* Left — selection info */}
      <span className="text-muted-foreground text-xs whitespace-nowrap min-w-25">
        {selectedCount > 0
          ? `${selectedCount} of ${totalRows} selected`
          : `${totalRows} row${totalRows !== 1 ? 's' : ''}`}
      </span>

      {/* Center — page info */}
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {totalRows > 0 ? `${from}–${to} of ${totalRows}` : 'No results'}
      </span>

      {/* Right — controls */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Page size selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
            <SelectTrigger className="h-7 w-17.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="First page"
          >
            <ChevronFirst className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          <span className="text-xs text-muted-foreground px-1 whitespace-nowrap">
            Page {pageIndex + 1} of {Math.max(1, pageCount)}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Last page"
          >
            <ChevronLast className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
