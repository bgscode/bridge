import { JSX, useEffect, useState } from 'react'
import { RefreshCw, Trash2, Edit2, Check, X } from 'lucide-react'
import type { JobVariable, JobVariableValue, ConnectionRow } from '@shared/index'
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
  connections: ConnectionRow[]
}

interface EditState {
  jobVariableId: number
  connectionId: number
  value: string
}

export function JobVariablesPanel({
  isOpen,
  onOpenChange,
  jobId,
  jobName,
  connections
}: JobVariablesPanelProps): JSX.Element {
  const [variables, setVariables] = useState<JobVariable[]>([])
  const [loading, setLoading] = useState(false)
  const [editState, setEditState] = useState<EditState | null>(null)

  const connById = new Map(connections.map((c) => [c.id, c]))

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
      setEditState(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, jobId])

  /** Connections whose ID appears in the job's connection list */
  const jobConnIds = new Set(connections.map((c) => c.id))

  async function saveEdit(): Promise<void> {
    if (!editState) return
    await window.api.jobVariables.setValue(
      editState.jobVariableId,
      editState.connectionId,
      editState.value
    )
    setEditState(null)
    void load()
  }

  async function deleteConnValues(connectionId: number): Promise<void> {
    await window.api.jobVariables.deleteConnectionValues(jobId, connectionId)
    void load()
  }

  // Collect all connection IDs that have stored values (includes orphans)
  const allConnIds = new Set<number>()
  for (const v of variables) {
    for (const val of v.values) allConnIds.add(val.connection_id)
  }
  const orphanConnIds = Array.from(allConnIds).filter((id) => !jobConnIds.has(id))

  if (variables.length === 0 && !loading) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl flex flex-col h-full p-0">
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
      <SheetContent className="w-full sm:max-w-2xl flex flex-col h-full p-0">
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
          {orphanConnIds.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 mt-2">
              <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">
                {orphanConnIds.length} orphaned connection value
                {orphanConnIds.length !== 1 ? 's' : ''} — from connections no longer on this job.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-amber-700 dark:text-amber-300 hover:text-destructive"
                onClick={async () => {
                  for (const id of orphanConnIds) {
                    await window.api.jobVariables.deleteConnectionValues(jobId, id)
                  }
                  void load()
                }}
              >
                Clean all
              </Button>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 flex flex-col gap-6">
            {variables.map((variable) => {
              const valueByConnId = new Map<number, JobVariableValue>(
                variable.values.map((v) => [v.connection_id, v])
              )
              const allRelevantConnIds = new Set([
                ...connections.map((c) => c.id),
                ...variable.values.map((v) => v.connection_id)
              ])

              return (
                <div key={variable.id} className="flex flex-col gap-2">
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
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      default:{' '}
                      <span className="font-mono">{variable.default_value ?? '(none)'}</span>
                    </span>
                  </div>

                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-xs table-fixed">
                      <colgroup>
                        <col className="w-[35%]" />
                        <col className="w-[30%]" />
                        <col className="w-[25%]" />
                        <col className="w-[10%]" />
                      </colgroup>
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Connection
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Current Value
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Last Updated
                          </th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(allRelevantConnIds).map((connId) => {
                          const conn = connById.get(connId)
                          const val = valueByConnId.get(connId)
                          const isOrphan = !jobConnIds.has(connId)
                          const isEditing =
                            editState?.jobVariableId === variable.id &&
                            editState?.connectionId === connId

                          return (
                            <tr
                              key={connId}
                              className={cn(
                                'border-t',
                                isOrphan && 'bg-amber-50/50 dark:bg-amber-950/10'
                              )}
                            >
                              <td className="px-3 py-2 truncate max-w-0">
                                <span
                                  className={cn(
                                    'block truncate',
                                    isOrphan && 'text-amber-600 dark:text-amber-400'
                                  )}
                                  title={conn?.name ?? `Connection #${connId}`}
                                >
                                  {conn?.name ?? `Connection #${connId}`}
                                </span>
                                {isOrphan && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-3.5 text-amber-600 border-amber-400 mt-0.5"
                                  >
                                    orphan
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-2 max-w-0">
                                {isEditing ? (
                                  <Input
                                    value={editState.value}
                                    onChange={(e) =>
                                      setEditState((prev) =>
                                        prev ? { ...prev, value: e.target.value } : null
                                      )
                                    }
                                    className="h-6 text-xs font-mono w-full"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void saveEdit()
                                      if (e.key === 'Escape') setEditState(null)
                                    }}
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    className="font-mono block truncate"
                                    title={val?.value ?? ''}
                                  >
                                    {val?.value ?? (
                                      <span className="text-muted-foreground italic">
                                        {variable.default_value ?? '(not set)'}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-0">
                                <span
                                  className="block truncate"
                                  title={
                                    val?.last_run_at
                                      ? new Date(val.last_run_at).toLocaleString()
                                      : ''
                                  }
                                >
                                  {val?.last_run_at
                                    ? new Date(val.last_run_at).toLocaleString()
                                    : '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1 justify-end">
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void saveEdit()}
                                        className="text-primary hover:text-primary/80"
                                      >
                                        <Check className="size-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditState(null)}
                                        className="text-muted-foreground hover:text-foreground"
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditState({
                                            jobVariableId: variable.id,
                                            connectionId: connId,
                                            value: val?.value ?? variable.default_value ?? ''
                                          })
                                        }
                                        className="text-muted-foreground hover:text-foreground"
                                        title="Override value"
                                      >
                                        <Edit2 className="size-3" />
                                      </button>
                                      {isOrphan && (
                                        <button
                                          type="button"
                                          onClick={() => void deleteConnValues(connId)}
                                          className="text-muted-foreground hover:text-destructive"
                                          title="Remove orphaned values"
                                        >
                                          <Trash2 className="size-3" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {allRelevantConnIds.size === 0 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                              No values yet — will populate after first run.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
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
