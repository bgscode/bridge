import { JSX, useEffect, useState } from 'react'
import { Play } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { JobRow, JobRunOptions } from '@shared/index'

interface JobRunDialogProps {
  open: boolean
  job: JobRow | null
  onOpenChange: (open: boolean) => void
  onConfirm: (options: JobRunOptions) => void
}

export function JobRunDialog({
  open,
  job,
  onOpenChange,
  onConfirm
}: JobRunDialogProps): JSX.Element | null {
  const [allConnections, setAllConnections] = useState(true)

  useEffect(() => {
    if (!open || !job) return
    // Run dialog defaults to all selected connections. User can untick to run
    // only currently online connections.
    setAllConnections(true)
  }, [open, job])

  if (!job) return null

  function handleConfirm(): void {
    const options: JobRunOptions = {
      online_only: !allConnections
    }

    onConfirm(options)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-4" />
            Run Job — {job.name}
          </DialogTitle>
          <DialogDescription>
            Confirm run options. Changes here apply to this run only; your saved job config is not
            modified.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Connections mode */}
          <div
            className={cn(
              'flex items-start justify-between gap-3 rounded-lg border p-3',
              allConnections && 'border-primary/40 bg-primary/5'
            )}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Include all selected connections</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {allConnections
                  ? `All ${job.connection_ids.length} selected connections will run (including offline).`
                  : `Only the online connections out of ${job.connection_ids.length} selected will run.`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Saved default:{' '}
                <Badge variant="outline" className="text-[10px] align-middle">
                  {job.online_only ? 'online only' : 'all connections'}
                </Badge>
              </p>
            </div>
            <Checkbox
              checked={allConnections}
              onCheckedChange={(v) => setAllConnections(Boolean(v))}
              aria-label="Include all selected connections"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            <Play className="size-4" />
            Run Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
