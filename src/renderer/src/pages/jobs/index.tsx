import { JSX, type SetStateAction, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { BriefcaseBusiness, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import type { CreateJobDto, JobRow, UpdateJobDto, JobRunOptions } from '@shared/index'
import { useJobGroups, useJobs } from '@/contexts'
import { useAuth } from '@/contexts/auth-context'
import { JobForm, type JobFormValues } from './components/form'
import { JobRunDialog } from './components/run-dialog'
import { formatUtcToIst } from '@/lib/utils'

// ─── Status badge helper ───────────────────────────────────────────────────────

const statusVariant: Record<JobRow['status'], 'default' | 'secondary' | 'outline' | 'destructive'> =
  {
    idle: 'secondary',
    running: 'default',
    success: 'outline',
    failed: 'destructive'
  }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobsPage(): JSX.Element {
  const { jobs, create, update, remove, removeMany, run } = useJobs()
  const { jobGroups } = useJobGroups()
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const isMountedRef = useRef(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<JobRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JobRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<JobRow | null>(null)

  useLayoutEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const handleRowSelectionChange = useCallback((next: SetStateAction<RowSelectionState>): void => {
    if (!isMountedRef.current) return
    setRowSelection((prev) => (typeof next === 'function' ? next(prev) : next))
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate(): void {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(job: JobRow): void {
    setSelected(job)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleFormSubmit(values: JobFormValues & { schedule?: string | null }): void {
    const isAction = values.type === 'action'
    const dto: CreateJobDto = {
      name: values.name,
      description: values.description ?? null,
      job_group_id: values.job_group_id ?? null,
      type: values.type,
      online_only: values.online_only,
      is_multi: values.is_multi,
      connection_ids: values.connection_ids,
      sql_query: values.sql_query,
      sql_query_names: values.is_multi ? values.sql_query_names : undefined,
      destination_type: isAction ? null : (values.destination_type ?? null),
      destination_config: values.destination_config ?? null,
      operation: isAction ? null : (values.operation ?? null),
      notify_webhook: values.notify_webhook || null,
      template_path: isAction ? null : (values.template_path ?? null),
      template_mode: isAction ? null : (values.template_mode ?? null),
      schedule: values.schedule ?? null
    }
    if (formMode === 'create') {
      create(dto)
    } else if (selected) {
      update(selected.id, dto as UpdateJobDto)
    }
  }

  function handleDuplicate(job: JobRow): void {
    create({
      name: `${job.name} (Copy)`,
      description: job.description,
      job_group_id: job.job_group_id,
      type: job.type,
      online_only: job.online_only,
      is_multi: job.is_multi,
      connection_ids: job.connection_ids,
      sql_query: job.sql_query,
      sql_query_names: job.sql_query_names,
      destination_type: job.destination_type,
      destination_config: job.destination_config,
      operation: job.operation,
      notify_webhook: job.notify_webhook,
      template_path: job.template_path,
      template_mode: job.template_mode,
      schedule: job.schedule
    })
  }

  function handleRunJob(job: JobRow): void {
    setRunTarget(job)
  }

  function handleRunConfirm(options: JobRunOptions): void {
    if (!runTarget) return
    run(runTarget.id, options)
    setRunTarget(null)
  }

  function handleDeleteConfirm(): void {
    if (!deleteTarget) return
    remove(deleteTarget.id).then(() => {
      if (!isMountedRef.current) return
      setDeleteTarget(null)
    })
  }

  function handleBulkDelete(): void {
    const ids = jobs.filter((j) => rowSelection[String(j.id)]).map((j) => j.id)
    removeMany(ids).then(() => {
      if (!isMountedRef.current) return
      setRowSelection({})
      setBulkDeleteOpen(false)
    })
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: DataGridColumnDef<JobRow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <Badge variant="outline">{row.original.name}</Badge>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant={row.original.type === 'query' ? 'default' : 'secondary'}>
          {row.original.type}
        </Badge>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      id: 'job_group_name',
      header: 'Job Group Name',
      accessorFn: (row) => {
        const group = jobGroups.find((g) => g.id === row.job_group_id)
        return group ? group.name : 'Ungrouped'
      },
      cell: ({ row }) => {
        const groupName =
          jobGroups.find((g) => g.id === row.original.job_group_id)?.name ?? 'Ungrouped'
        return <span className="text-sm text-muted-foreground">{groupName}</span>
      },
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={statusVariant[row.original.status]}>{row.original.status}</Badge>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'online_only',
      header: 'Online Only',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.online_only ? 'Yes' : 'No'}
        </span>
      ),
      meta: { resizable: true }
    },
    {
      accessorKey: 'is_multi',
      header: 'Multi',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.is_multi ? 'Yes' : 'No'}
        </span>
      ),
      meta: { resizable: true }
    },
    {
      accessorKey: 'last_run_at',
      header: 'Last Run',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.last_run_at ? formatUtcToIst(row.original.last_run_at) : '—'}
        </span>
      ),
      meta: { filterType: 'date', resizable: true }
    },
    {
      accessorKey: 'last_error',
      header: 'Last Error',
      cell: ({ row }) => (
        <span
          className="text-sm text-muted-foreground truncate max-w-xs"
          title={row.original.last_error || ''}
        >
          {row.original.last_error || '—'}
        </span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.description || '—'}</span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      size: 52,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            onEdit={isAdmin ? () => handleEdit(row.original) : undefined}
            onDuplicate={isAdmin ? () => handleDuplicate(row.original) : undefined}
            onDelete={isAdmin ? () => setDeleteTarget(row.original) : undefined}
            extraItems={
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRunJob(row.original)
                  }}
                >
                  <Play className="size-4" />
                  Run Now
                </DropdownMenuItem>
                {row.original.status === 'failed' && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRunJob(row.original)
                    }}
                  >
                    <RotateCcw className="size-4" />
                    Retry
                  </DropdownMenuItem>
                )}
              </>
            }
          />
        </div>
      )
    }
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedCount = Object.keys(rowSelection).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <BriefcaseBusiness className="size-4 text-muted-foreground" />
              Jobs
            </CardTitle>
            <CardDescription className="text-sm">Manage data sync jobs.</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
              <Plus className="size-4" />
              New Job
            </Button>
          )}
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<JobRow>
            data={jobs}
            columns={columns}
            persistStateKey="jobs-grid"
            selectionMode="multiple"
            className="flex-1 rounded-none border-0"
            enableColumnResizing={true}
            getRowId={(row) => String(row.id)}
            rowSelection={rowSelection}
            onRowSelectionChange={handleRowSelectionChange}
            toolbar={{
              showSearch: true,
              showExport: isAdmin,
              showColumnToggle: true,
              showFilterPanel: true,
              showDensityToggle: true,
              customActions: (
                <>
                  {isAdmin && selectedCount > 0 && (
                    <>
                      <Separator orientation="vertical" className="h-6" />
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBulkDeleteOpen(true)}
                      >
                        <Trash2 className="size-4 mr-1" />
                        Delete {selectedCount}
                      </Button>
                    </>
                  )}
                </>
              )
            }}
          />
        </CardContent>
      </Card>

      {/* Create / Edit Form */}
      <JobForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={selected ? { ...selected, schedule_raw: selected.schedule } : undefined}
        onSubmit={handleFormSubmit}
      />

      {/* Single Delete */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && isMountedRef.current) {
            setDeleteTarget(null)
          }
        }}
        title="Delete Job"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDeleteConfirm}
      />

      {/* Bulk Delete */}
      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!isMountedRef.current) return
          setBulkDeleteOpen(open)
        }}
        title="Delete Jobs"
        description={`Are you sure you want to delete ${selectedCount} job(s)? This cannot be undone.`}
        onConfirm={handleBulkDelete}
      />

      {/* Run dialog */}
      <JobRunDialog
        open={!!runTarget}
        job={runTarget}
        onOpenChange={(o) => {
          if (!o && isMountedRef.current) setRunTarget(null)
        }}
        onConfirm={handleRunConfirm}
      />
    </div>
  )
}
