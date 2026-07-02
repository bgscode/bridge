import { JSX, useEffect, useState } from 'react'
import { RefreshCw, Check, X } from 'lucide-react'
import type { JobVariable, ConnectionRow } from '@shared/index'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface JobVariablesPanelProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  jobId: number
  jobName: string
  jobRemoteId?: string | null
  canEdit: boolean
  connections: ConnectionRow[]
}

function effectiveValue(variable: JobVariable, connectionId: number): string {
  const stored = variable.values.find((value) => value.connection_id === connectionId)
  return stored?.value ?? variable.default_value ?? ''
}

function getJobWideDisplayValue(variable: JobVariable, connectionIds: number[]): string {
  if (connectionIds.length === 0) return variable.default_value ?? ''

  const values = connectionIds.map((id) => effectiveValue(variable, id))
  const first = values[0] ?? ''
  if (values.every((value) => value === first)) return first
  return variable.default_value ?? first
}

function connectionsHaveMixedValues(variable: JobVariable, connectionIds: number[]): boolean {
  if (connectionIds.length <= 1) return false
  const values = connectionIds.map((id) => effectiveValue(variable, id))
  const first = values[0]
  return values.some((value) => value !== first)
}

export function JobVariablesPanel({
  isOpen,
  onOpenChange,
  jobId,
  jobName,
  canEdit,
  connections
}: JobVariablesPanelProps): JSX.Element {
  const [variables, setVariables] = useState<JobVariable[]>([])
  const [loading, setLoading] = useState(false)
  const [editingVariableId, setEditingVariableId] = useState<number | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [savingVariableId, setSavingVariableId] = useState<number | null>(null)

  const connectionIds = connections.map((connection) => connection.id)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const vars = await window.api.jobVariables.getAll(jobId)
      setVariables(vars)
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      void load()
    } else {
      setVariables([])
      setEditingVariableId(null)
      setDraftValue('')
      setSavingVariableId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, jobId])

  function startEdit(variable: JobVariable): void {
    setEditingVariableId(variable.id)
    setDraftValue(getJobWideDisplayValue(variable, connectionIds))
  }

  async function saveJobWideValue(variableId: number): Promise<void> {
    setSavingVariableId(variableId)
    try {
      await window.api.jobVariables.setJobValue(variableId, connectionIds, draftValue)
      setEditingVariableId(null)
      setDraftValue('')
      await load()
    } finally {
      setSavingVariableId(null)
    }
  }

  if (variables.length === 0 && !loading) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col h-full p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle>Job Variables</SheetTitle>
            <SheetDescription>{jobName}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No variables defined for this job yet.</p>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col h-full p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SheetTitle>Job Variables</SheetTitle>
              <SheetDescription className="truncate">{jobName}</SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One value per variable applies to all {connections.length} connection
            {connections.length === 1 ? '' : 's'} on this job.
          </p>
          {!canEdit && (
            <p className="mt-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              View only — you do not have permission to edit variables for this job.
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 flex flex-col gap-4">
            {variables.map((variable) => {
              const displayValue = getJobWideDisplayValue(variable, connectionIds)
              const mixed = connectionsHaveMixedValues(variable, connectionIds)
              const isEditing = editingVariableId === variable.id
              const isSaving = savingVariableId === variable.id

              return (
                <div key={variable.id} className="rounded-lg border p-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-primary">
                      {`{{${variable.name}}}`}
                    </span>
                    {variable.description && (
                      <span className="text-xs text-muted-foreground">{variable.description}</span>
                    )}
                    {variable.auto_update && variable.source_column && (
                      <Badge variant="secondary" className="text-[10px] h-4 shrink-0">
                        auto: {variable.update_fn}({variable.source_column})
                      </Badge>
                    )}
                  </div>

                  {mixed && !isEditing && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Connections currently have different values. Saving will set the same value
                      for all connections.
                    </p>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Current value</span>
                    {canEdit && isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={draftValue}
                          onChange={(event) => setDraftValue(event.target.value)}
                          className="h-8 text-sm font-mono"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveJobWideValue(variable.id)
                            if (event.key === 'Escape') {
                              setEditingVariableId(null)
                              setDraftValue('')
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          onClick={() => void saveJobWideValue(variable.id)}
                          disabled={isSaving}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          onClick={() => {
                            setEditingVariableId(null)
                            setDraftValue('')
                          }}
                          disabled={isSaving}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm flex-1 truncate" title={displayValue}>
                          {displayValue || (
                            <span className="text-muted-foreground italic">(not set)</span>
                          )}
                        </span>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs shrink-0"
                            onClick={() => startEdit(variable)}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
