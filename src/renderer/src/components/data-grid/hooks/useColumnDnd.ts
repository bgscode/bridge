import { useCallback, useState } from 'react'
import type { ColumnOrderState } from '@tanstack/react-table'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export { DndContext, closestCenter, SortableContext, horizontalListSortingStrategy }

export function useColumnDnd(
  columnOrder: ColumnOrderState,
  onColumnOrderChange: (order: ColumnOrderState) => void
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = columnOrder.indexOf(String(active.id))
      const newIndex = columnOrder.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex)
      onColumnOrderChange(newOrder)
    },
    [columnOrder, onColumnOrderChange]
  )

  return { sensors, handleDragEnd }
}

// ─── useSortableColumn — used per-header cell ────────────────────────────────
export function useSortableColumn(columnId: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnId
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab'
  }

  return { attributes, listeners, setNodeRef, style, isDragging }
}

// ─── useGlobalFilter with debounce ───────────────────────────────────────────
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null }

  const update = useCallback(
    (v: T) => {
      clearTimeout(timerRef.current ?? undefined)
      timerRef.current = setTimeout(() => setDebounced(v), delay)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [delay]
  )

  // Keep debounced in sync when value changes externally
  if (debounced !== value) update(value)

  return debounced
}
