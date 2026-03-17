import { useRef, memo, type RefObject } from 'react'
import { flexRender, type Table, type Row } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { getPinClassName, getPinStyles } from './utils/column.utils'
import type { DataGridDensity } from './types'

interface DataGridBodyProps<TData> {
  table: Table<TData>
  density: DataGridDensity
  enableVirtualization?: boolean
  estimatedRowHeight?: number
  selectionMode?: 'single' | 'multiple' | 'none'
  onRowClick?: (row: Row<TData>) => void
  loading?: boolean
  emptyMessage?: string
  renderEmptyState?: () => React.ReactNode
  height?: number | string
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

const DENSITY_ROW_CLASS: Record<DataGridDensity, string> = {
  compact: 'h-8 text-xs',
  standard: 'h-10 text-sm',
  comfortable: 'h-14 text-sm'
}

const DENSITY_TEXT_CLASS: Record<DataGridDensity, string> = {
  compact: 'text-xs',
  standard: 'text-sm',
  comfortable: 'text-sm'
}

const DENSITY_ROW_HEIGHT: Record<DataGridDensity, number> = {
  compact: 32,
  standard: 40,
  comfortable: 56
}

export function DataGridBody<TData>({
  table,
  density,
  enableVirtualization = false,
  estimatedRowHeight,
  selectionMode,
  onRowClick,
  loading,
  emptyMessage = 'No results found.',
  renderEmptyState,
  scrollContainerRef
}: DataGridBodyProps<TData>) {
  // When virtualization is enabled, use all rows (pre-pagination) so the virtualizer
  // handles the "windowing" instead of pagination. Otherwise use paginated rows.
  const rows = enableVirtualization
    ? table.getPrePaginationRowModel().rows
    : table.getRowModel().rows
  const fallbackRef = useRef<HTMLDivElement>(null)
  const rowHeight = estimatedRowHeight ?? DENSITY_ROW_HEIGHT[density]

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => (scrollContainerRef ?? fallbackRef).current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: enableVirtualization && rows.length > 0
  })

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <tbody>
        {Array.from({ length: 8 }).map((_, i) => (
          <tr key={i} className={cn('border-b', DENSITY_ROW_CLASS[density])}>
            {table.getVisibleLeafColumns().map((col) => (
              <td key={col.id} className="px-3">
                <div className="h-4 bg-muted animate-pulse rounded" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!rows.length) {
    return (
      <tbody>
        <tr>
          <td
            colSpan={table.getVisibleLeafColumns().length}
            className="h-32 text-center text-sm text-muted-foreground"
          >
            {renderEmptyState ? renderEmptyState() : emptyMessage}
          </td>
        </tr>
      </tbody>
    )
  }

  const columnOrderKey = table.getState().columnOrder.join(',')
  const columnPinningKey = [
    ...(table.getState().columnPinning.left ?? []),
    '|',
    ...(table.getState().columnPinning.right ?? [])
  ].join(',')
  const columnSizingKey = Object.values(table.getState().columnSizing).join(',')

  if (enableVirtualization) {
    const virtualItems = virtualizer.getVirtualItems()

    return (
      <tbody
        style={{
          display: 'block',
          height: virtualizer.getTotalSize(),
          position: 'relative',
          willChange: 'transform',
          contain: 'strict'
        }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]
          return (
            <BodyRow
              key={row.id}
              row={row}
              isSelected={row.getIsSelected()}
              columnOrderKey={columnOrderKey}
              columnPinningKey={columnPinningKey}
              columnSizingKey={columnSizingKey}
              density={density}
              selectionMode={selectionMode}
              onRowClick={onRowClick}
              virtualStyle={{
                display: 'flex',
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`
              }}
            />
          )
        })}
      </tbody>
    )
  }

  return (
    <tbody>
      {rows.map((row) => (
        <BodyRow
          key={row.id}
          row={row}
          isSelected={row.getIsSelected()}
          columnOrderKey={columnOrderKey}
          columnPinningKey={columnPinningKey}
          columnSizingKey={columnSizingKey}
          density={density}
          selectionMode={selectionMode}
          onRowClick={onRowClick}
        />
      ))}
    </tbody>
  )
}

const BodyRow = memo(function BodyRow<TData>({
  row,
  isSelected,
  columnOrderKey: _columnOrderKey,
  columnPinningKey: _columnPinningKey,
  columnSizingKey: _columnSizingKey,
  density,
  selectionMode,
  onRowClick,
  virtualStyle
}: {
  row: Row<TData>
  isSelected: boolean
  columnOrderKey: string
  columnPinningKey: string
  columnSizingKey: string
  density: DataGridDensity
  selectionMode?: 'single' | 'multiple' | 'none'
  onRowClick?: (row: Row<TData>) => void
  virtualStyle?: React.CSSProperties
}) {
  const isVirtualized = !!virtualStyle

  return (
    <tr
      style={virtualStyle}
      onMouseEnter={(e) => {
        e.currentTarget.querySelectorAll<HTMLTableCellElement>('td[data-pinned]').forEach((td) => {
          td.style.backgroundColor = isSelected
            ? 'color-mix(in srgb, var(--color-primary) 10%, var(--color-background))'
            : 'color-mix(in srgb, var(--color-muted-foreground) 6%, var(--color-background))'
        })
      }}
      onMouseLeave={(e) => {
        e.currentTarget.querySelectorAll<HTMLTableCellElement>('td[data-pinned]').forEach((td) => {
          td.style.backgroundColor = isSelected
            ? 'color-mix(in srgb, var(--color-primary) 8%, var(--color-background))'
            : 'var(--color-background)'
        })
      }}
      onClick={() => {
        onRowClick?.(row)
        if (selectionMode === 'single') row.toggleSelected()
      }}
      data-selected={isSelected ? 'true' : 'false'}
      className={cn(
        'group border-b transition-colors',
        isVirtualized ? DENSITY_TEXT_CLASS[density] : DENSITY_ROW_CLASS[density],
        isSelected ? 'bg-primary/8 hover:bg-primary/10' : 'hover:bg-muted/50',
        (selectionMode === 'single' || onRowClick) && 'cursor-pointer'
      )}
    >
      {row.getVisibleCells().map((cell) => {
        const column = cell.column
        const isSelect = column.id === 'select'

        return (
          <td
            key={cell.id}
            data-pinned={column.getIsPinned() || undefined}
            style={{
              width: column.getSize(),
              minWidth: column.getSize(),
              maxWidth: column.getSize(),
              ...getPinStyles(column),
              ...(column.getIsPinned() && isSelected
                ? {
                    backgroundColor:
                      'color-mix(in srgb, var(--color-primary) 8%, var(--color-background))'
                  }
                : {}),
              // When virtualized, td must flex to fill the row height
              ...(isVirtualized
                ? {
                    display: 'flex',
                    alignItems: 'center',
                    height: '100%',
                    flexShrink: 0,
                    flexGrow: 0,
                    boxSizing: 'border-box'
                  }
                : {})
            }}
            className={cn('overflow-hidden whitespace-nowrap px-3', getPinClassName(column))}
          >
            {isSelect ? (
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => row.toggleSelected(!!checked)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Select row"
                className="translate-y-px"
              />
            ) : (
              <span className="truncate block">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </span>
            )}
          </td>
        )
      })}
    </tr>
  )
}) as <TData>(props: {
  row: Row<TData>
  isSelected: boolean
  columnOrderKey: string
  columnPinningKey: string
  columnSizingKey: string
  density: DataGridDensity
  selectionMode?: 'single' | 'multiple' | 'none'
  onRowClick?: (row: Row<TData>) => void
  virtualStyle?: React.CSSProperties
}) => React.ReactElement
