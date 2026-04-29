import { MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// ─── RowActionsMenu ────────────────────────────────────────────────────────────
// Reusable ⋯ actions menu for data grid / table rows.
// Shows Edit, Duplicate, and Delete actions.
//
// Usage:
//   <RowActionsMenu
//     onEdit={() => handleEdit(row.original)}
//     onDuplicate={() => handleDuplicate(row.original)}
//     onDelete={() => setDeleteTarget(row.original)}
//   />

interface RowActionsMenuProps {
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  /** Extra menu items rendered after Edit and before the separator+Delete */
  extraItems?: React.ReactNode
}

export function RowActionsMenu({ onEdit, onDuplicate, onDelete, extraItems }: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 data-[state=open]:bg-accent"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {onEdit && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        )}
        {onDuplicate && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
          >
            <Copy className="size-4" />
            Duplicate
          </DropdownMenuItem>
        )}
        {extraItems}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
