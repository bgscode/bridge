import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

// ─── DeleteConfirmDialog ───────────────────────────────────────────────────────
// Reusable confirmation dialog for destructive delete actions.
//
// Usage:
//   <DeleteConfirmDialog
//     open={!!deleteTarget}
//     onOpenChange={(open) => !open && setDeleteTarget(null)}
//     title="Delete Store"
//     description={<>Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>?</>}
//     onConfirm={handleDeleteConfirm}
//   />

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog title, e.g. "Delete Store" */
  title: string
  /** Custom description / body content */
  description?: React.ReactNode
  /** Label for the destructive confirm button (default: "Delete") */
  confirmLabel?: string
  /** Called when user confirms deletion */
  onConfirm: () => void
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm
}: DeleteConfirmDialogProps) {
  function handleConfirm() {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Trash2 className="size-4 text-destructive" />
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-sm" asChild>
              <div>{description}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
