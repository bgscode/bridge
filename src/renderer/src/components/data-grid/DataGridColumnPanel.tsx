import type { Table } from '@tanstack/react-table'
import { GripVertical, Pin, PinOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { arrayMove } from '@dnd-kit/sortable'
import { useSensors, useSensor, PointerSensor } from '@dnd-kit/core'

interface DataGridColumnPanelProps<TData> {
  table: Table<TData>
  onReset: () => void
}

export function DataGridColumnPanel<TData>({ table, onReset }: DataGridColumnPanelProps<TData>) {
  const columns = table
    .getAllLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions')

  const columnOrder = table.getState().columnOrder
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: { active: { id: unknown }; over: { id: unknown } | null }) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Use full column order (includes select/actions) so index mapping is correct
    const allIds = table.getAllLeafColumns().map((c) => c.id)
    const currentOrder = columnOrder.length ? columnOrder : allIds

    const oldIndex = currentOrder.indexOf(String(active.id))
    const newIndex = currentOrder.indexOf(String(over.id))
    if (oldIndex !== -1 && newIndex !== -1) {
      table.setColumnOrder(arrayMove(currentOrder, oldIndex, newIndex))
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 w-64">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Columns
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 px-2" onClick={onReset}>
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5 max-h-80 overflow-y-auto pr-1">
            {columns.map((column) => (
              <ColumnPanelItem
                key={column.id}
                id={column.id}
                label={
                  typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id
                }
                visible={column.getIsVisible()}
                pinned={column.getIsPinned()}
                canHide={column.getCanHide()}
                onToggleVisible={() => column.toggleVisibility()}
                onTogglePin={() => (column.getIsPinned() ? column.pin(false) : column.pin('left'))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function ColumnPanelItem({
  id,
  label,
  visible,
  pinned,
  canHide,
  onToggleVisible,
  onTogglePin
}: {
  id: string
  label: string
  visible: boolean
  pinned: false | 'left' | 'right'
  canHide: boolean
  onToggleVisible: () => void
  onTogglePin: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted',
        isDragging && 'opacity-50 bg-muted'
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      <Checkbox
        checked={visible}
        onCheckedChange={onToggleVisible}
        disabled={!canHide}
        aria-label={`Toggle ${label}`}
        className="h-3.5 w-3.5"
      />

      <span className={cn('flex-1 truncate', !visible && 'text-muted-foreground line-through')}>
        {label}
      </span>

      <button
        type="button"
        onClick={onTogglePin}
        title={pinned ? 'Unpin' : 'Pin left'}
        className="text-muted-foreground/40 hover:text-muted-foreground"
      >
        {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
      </button>
    </li>
  )
}
