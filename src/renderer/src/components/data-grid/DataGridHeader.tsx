import { useRef } from 'react'
import { flexRender, type Table, type Header } from '@tanstack/react-table'
import { ArrowUp, ArrowDown, ArrowUpDown, Pin, PinOff, GripVertical } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getPinClassName, getPinStyles } from './utils/column.utils'
import type { DataGridDensity } from './types'

interface DataGridHeaderProps<TData> {
  table: Table<TData>
  density: DataGridDensity
  enableColumnReordering?: boolean
  enableColumnPinning?: boolean
  enableColumnResizing?: boolean
  selectionMode?: 'single' | 'multiple' | 'none'
  enableVirtualization?: boolean
}

const DENSITY_HEADER_CLASS: Record<DataGridDensity, string> = {
  compact: 'h-8 text-xs',
  standard: 'h-10 text-xs',
  comfortable: 'h-12 text-sm'
}

export function DataGridHeader<TData>({
  table,
  density,
  enableColumnReordering,
  enableColumnPinning,
  selectionMode,
  enableVirtualization
}: DataGridHeaderProps<TData>) {
  // All drag state lives in refs — NEVER in React state during drag.
  // React re-renders during an active native drag cancel the drag in Chromium.
  // Strategy: mutate DOM attributes directly for drop indicator (no re-render),
  // commit the actual columnOrder change only on onDrop.
  const draggingIdRef = useRef<string | null>(null)
  const dropTargetIdRef = useRef<string | null>(null)
  const thRefsMap = useRef<Map<string, HTMLTableCellElement>>(new Map())

  function setDropHighlight(colId: string | null) {
    thRefsMap.current.forEach((el, id) => {
      el.setAttribute('data-drop-target', id === colId ? 'true' : 'false')
    })
  }

  return (
    <thead
      className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm"
      style={enableVirtualization ? { display: 'block' } : undefined}
    >
      {table.getHeaderGroups().map((headerGroup) => (
        <tr
          key={headerGroup.id}
          className="border-b"
          style={enableVirtualization ? { display: 'flex', width: '100%' } : undefined}
        >
          {headerGroup.headers.map((header) => (
            <HeaderCell
              key={header.id}
              header={header as Header<unknown, unknown>}
              tableRef={table as Table<unknown>}
              density={density}
              enableColumnReordering={enableColumnReordering}
              enableColumnPinning={enableColumnPinning}
              selectionMode={selectionMode}
              enableVirtualization={enableVirtualization}
              draggingIdRef={draggingIdRef}
              dropTargetIdRef={dropTargetIdRef}
              thRefsMap={thRefsMap}
              setDropHighlight={setDropHighlight}
            />
          ))}
        </tr>
      ))}
    </thead>
  )
}

function HeaderCell({
  header,
  tableRef,
  density,
  enableColumnReordering,
  enableColumnPinning,
  selectionMode,
  enableVirtualization,
  draggingIdRef,
  dropTargetIdRef,
  thRefsMap,
  setDropHighlight
}: {
  header: Header<unknown, unknown>
  tableRef: Table<unknown>
  density: DataGridDensity
  enableColumnReordering?: boolean
  enableColumnPinning?: boolean
  selectionMode?: 'single' | 'multiple' | 'none'
  enableVirtualization?: boolean
  draggingIdRef: React.MutableRefObject<string | null>
  dropTargetIdRef: React.MutableRefObject<string | null>
  thRefsMap: React.MutableRefObject<Map<string, HTMLTableCellElement>>
  setDropHighlight: (colId: string | null) => void
}) {
  const column = header.column
  const isSelect = column.id === 'select'
  const isActions = column.id === 'actions'
  const canSort = column.getCanSort()
  const sorted = column.getIsSorted()
  const pinned = column.getIsPinned()
  const isDraggable = !!enableColumnReordering && !isSelect && !isActions

  function handleDragStart(e: React.DragEvent<HTMLTableCellElement>) {
    draggingIdRef.current = column.id
    dropTargetIdRef.current = null
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column.id)
  }

  function handleDragOver(e: React.DragEvent<HTMLTableCellElement>) {
    if (!draggingIdRef.current || draggingIdRef.current === column.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetIdRef.current !== column.id) {
      dropTargetIdRef.current = column.id
      setDropHighlight(column.id)
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLTableCellElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    if (dropTargetIdRef.current === column.id) {
      dropTargetIdRef.current = null
      setDropHighlight(null)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault()
    const draggedId = draggingIdRef.current
    if (!draggedId || draggedId === column.id) {
      cleanup()
      return
    }
    const order = tableRef.getState().columnOrder
    const allIds = tableRef.getAllLeafColumns().map((c) => c.id)
    const ordered = order.length ? [...order] : [...allIds]
    const fromIdx = ordered.indexOf(draggedId)
    const toIdx = ordered.indexOf(column.id)
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
      ordered.splice(fromIdx, 1)
      ordered.splice(toIdx, 0, draggedId)
      tableRef.setColumnOrder(ordered)
    }
    cleanup()
  }

  function handleDragEnd() {
    cleanup()
  }

  function cleanup() {
    draggingIdRef.current = null
    dropTargetIdRef.current = null
    setDropHighlight(null)
  }

  return (
    <th
      ref={(el) => {
        if (el) thRefsMap.current.set(column.id, el)
        else thRefsMap.current.delete(column.id)
      }}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragOver={isDraggable ? handleDragOver : undefined}
      onDragLeave={isDraggable ? handleDragLeave : undefined}
      onDrop={isDraggable ? handleDrop : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      data-drop-target="false"
      style={{
        width: header.getSize(),
        minWidth: header.getSize(),
        maxWidth: header.getSize(),
        ...getPinStyles(column),
        ...(enableVirtualization
          ? {
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              flexGrow: 0,
              boxSizing: 'border-box'
            }
          : {})
      }}
      className={cn(
        'group relative select-none font-medium text-muted-foreground whitespace-nowrap overflow-hidden',
        'data-[drop-target=true]:bg-primary/15 data-[drop-target=true]:border-l-2 data-[drop-target=true]:border-l-primary',
        DENSITY_HEADER_CLASS[density],
        getPinClassName(column),
        isDraggable && 'cursor-grab'
      )}
    >
      <div className="flex items-center gap-1 px-3 h-full">
        {isDraggable && (
          <span className="text-muted-foreground/40 hover:text-muted-foreground shrink-0">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}

        {isSelect && selectionMode === 'multiple' ? (
          <Checkbox
            checked={
              tableRef.getIsAllPageRowsSelected()
                ? true
                : tableRef.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(checked) => tableRef.toggleAllPageRowsSelected(!!checked)}
            aria-label="Select all"
            className="translate-y-px"
          />
        ) : isSelect ? null : (
          <button
            type="button"
            onClick={canSort ? column.getToggleSortingHandler() : undefined}
            className={cn(
              'flex items-center gap-1 truncate flex-1 min-w-0',
              canSort && 'cursor-pointer hover:text-foreground'
            )}
          >
            <span className="truncate">
              {header.isPlaceholder
                ? null
                : flexRender(column.columnDef.header, header.getContext())}
            </span>
            {canSort && (
              <span className="shrink-0 ml-auto">
                {sorted === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : sorted === 'desc' ? (
                  <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                )}
              </span>
            )}
          </button>
        )}

        {enableColumnPinning && !isSelect && !isActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Pin column"
                className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-muted-foreground"
              >
                {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-30">
              {pinned !== 'left' && (
                <DropdownMenuItem onClick={() => column.pin('left')}>
                  <Pin className="h-3.5 w-3.5 mr-2" />
                  Pin Left
                </DropdownMenuItem>
              )}
              {pinned !== 'right' && (
                <DropdownMenuItem onClick={() => column.pin('right')}>
                  <Pin className="h-3.5 w-3.5 mr-2 scale-x-[-1]" />
                  Pin Right
                </DropdownMenuItem>
              )}
              {pinned && (
                <DropdownMenuItem onClick={() => column.pin(false)}>
                  <PinOff className="h-3.5 w-3.5 mr-2" />
                  Unpin
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={cn(
            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
            'hover:bg-primary/40',
            column.getIsResizing() && 'bg-primary'
          )}
        />
      )}
    </th>
  )
}
