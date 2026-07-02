import {
  JSX,
  type CSSProperties,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { RowSelectionState } from '@tanstack/react-table'
import { BriefcaseBusiness, Link2, Play, Plus, RotateCcw, Trash2, Variable } from 'lucide-react'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import type { CreateJobDto, JobRow, UpdateJobDto, JobRunOptions } from '@shared/index'
import { useConnections, useJobGroups, useJobs } from '@/contexts'
import { useAuth } from '@/contexts/auth-context'
import { JobForm, type JobFormValues } from './components/form'
import { JobRunDialog } from './components/run-dialog'
import { JobVariablesPanel } from './components/job-variables-panel'
import { formatUtcToIst } from '@/lib/utils'

// ─── Status badge helper ───────────────────────────────────────────────────────

const statusVariant: Record<JobRow['status'], 'default' | 'secondary' | 'outline' | 'destructive'> =
  {
    idle: 'secondary',
    running: 'default',
    success: 'outline',
    failed: 'destructive'
  }

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/)

  if (!shortHex) {
    return null
  }

  const [red, green, blue] = shortHex[1].split('')

  return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHexColor(hex)

  if (!normalized) {
    return 'transparent'
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)
  const opacity = Math.min(Math.max(alpha, 0), 1)

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function getJobRowTintStyle(job: JobRow): CSSProperties | undefined {
  const color = normalizeHexColor(job.job_color)

  if (!color) {
    return undefined
  }

  return {
    ['--data-grid-row-bg' as '--data-grid-row-bg']: hexToRgba(color, 0.3),
    ['--data-grid-row-hover-bg' as '--data-grid-row-hover-bg']: hexToRgba(color, 0.38),
    ['--data-grid-row-pinned-bg' as '--data-grid-row-pinned-bg']: `color-mix(in srgb, ${color} 16%, var(--color-background))`,
    ['--data-grid-row-pinned-hover-bg' as '--data-grid-row-pinned-hover-bg']: `color-mix(in srgb, ${color} 22%, var(--color-background))`
  } as CSSProperties
}

function hasJobTint(job: JobRow): boolean {
  return normalizeHexColor(job.job_color) !== null
}

function getTintedNeutralBadgeClass(job: JobRow): string | undefined {
  if (!hasJobTint(job)) {
    return undefined
  }

  return 'border-slate-900/12 bg-white/86 text-slate-950 shadow-sm'
}

function getTintedTypeBadgeClass(job: JobRow): string | undefined {
  if (!hasJobTint(job)) {
    return undefined
  }

  return job.type === 'query'
    ? 'border border-slate-950/8 bg-slate-950 text-white shadow-sm'
    : 'border border-slate-900/12 bg-white/88 text-slate-950 shadow-sm'
}

function getTintedStatusBadgeClass(job: JobRow): string | undefined {
  if (!hasJobTint(job)) {
    return undefined
  }

  switch (job.status) {
    case 'success':
      return 'border-emerald-700/20 bg-emerald-50/92 text-emerald-800 shadow-sm'
    case 'failed':
      return 'border-red-700/18 bg-red-50/92 text-red-700 shadow-sm'
    case 'running':
      return 'border-sky-700/18 bg-sky-700 text-white shadow-sm'
    case 'idle':
    default:
      return 'border-slate-900/12 bg-white/88 text-slate-700 shadow-sm'
  }
}

function getTintedMutedTextClass(job: JobRow): string {
  return hasJobTint(job) ? 'text-slate-700' : 'text-muted-foreground'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobsPage(): JSX.Element {
  const { jobs, create, update, remove, removeMany, run } = useJobs()
  const { jobGroups } = useJobGroups()
  const { connections } = useConnections()
  const { user: me, canEditJobVariables } = useAuth()
  const navigate = useNavigate()
  const isAdmin = me?.role === 'admin'
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const isMountedRef = useRef(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<JobRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JobRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<JobRow | null>(null)
  const [varPanelJob, setVarPanelJob] = useState<JobRow | null>(null)

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

  async function handleFormSubmit(
    values: JobFormValues & { schedule?: string | null }
  ): Promise<void> {
    const isAction = values.type === 'action'
    const dto: CreateJobDto = {
      name: values.name,
      description: values.description ?? null,
      job_color: values.job_color ?? null,
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
      modify_dates: isAction ? true : (values.modify_dates ?? true),
      schedule: values.schedule ?? null,
      summary_extra_columns:
        !isAction &&
        (values.destination_type === 'excel' || values.destination_type === 'google_sheets')
          ? (values.summary_extra_columns ?? null)
          : null,
      excel_combine_sheets:
        !isAction &&
        (values.destination_type === 'excel' || values.destination_type === 'google_sheets') &&
        !values.is_multi
          ? (values.excel_combine_sheets ?? false)
          : false
    }
    if (formMode === 'create') {
      await create(dto)
    } else if (selected) {
      await update(selected.id, dto as UpdateJobDto)
    }
  }

  function handleDuplicate(job: JobRow): void {
    create({
      name: `${job.name} (Copy)`,
      description: job.description,
      job_color: job.job_color,
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
      modify_dates: job.modify_dates,
      schedule: job.schedule,
      summary_extra_columns: job.summary_extra_columns,
      excel_combine_sheets: job.excel_combine_sheets
    })
  }

  function handleRunJob(job: JobRow): void {
    setRunTarget(job)
  }

  function handleEditConnections(job: JobRow): void {
    navigate(`/jobs/${job.id}/connections`)
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
      cell: ({ row }) => (
        <Badge variant="outline" className={getTintedNeutralBadgeClass(row.original)}>
          {row.original.name}
        </Badge>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge
          variant={row.original.type === 'query' ? 'default' : 'secondary'}
          className={getTintedTypeBadgeClass(row.original)}
        >
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
        return (
          <span className={`text-sm ${getTintedMutedTextClass(row.original)}`}>{groupName}</span>
        )
      },
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant={statusVariant[row.original.status]}
          className={getTintedStatusBadgeClass(row.original)}
        >
          {row.original.status}
        </Badge>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'online_only',
      header: 'Online Only',
      cell: ({ row }) => (
        <span className={`text-sm ${getTintedMutedTextClass(row.original)}`}>
          {row.original.online_only ? 'Yes' : 'No'}
        </span>
      ),
      meta: { resizable: true }
    },
    {
      accessorKey: 'is_multi',
      header: 'Multi',
      cell: ({ row }) => (
        <span className={`text-sm ${getTintedMutedTextClass(row.original)}`}>
          {row.original.is_multi ? 'Yes' : 'No'}
        </span>
      ),
      meta: { resizable: true }
    },
    {
      accessorKey: 'last_run_at',
      header: 'Last Run',
      cell: ({ row }) => (
        <span className={`text-sm ${getTintedMutedTextClass(row.original)}`}>
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
          className={`text-sm truncate max-w-xs ${getTintedMutedTextClass(row.original)}`}
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
        <span className={`text-sm ${getTintedMutedTextClass(row.original)}`}>
          {row.original.description || '—'}
        </span>
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
                    handleEditConnections(row.original)
                  }}
                >
                  <Link2 className="size-4" />
                  Edit Connections
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRunJob(row.original)
                  }}
                >
                  <Play className="size-4" />
                  Run Now
                </DropdownMenuItem>
                {row.original.type === 'query' && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      setVarPanelJob(row.original)
                    }}
                  >
                    <Variable className="size-4" />
                    Variables
                  </DropdownMenuItem>
                )}
                {row.original.status === 'failed' && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      // Retry only the connections that errored or never ran
                      // on the previous run. Falls back to running every
                      // connection when nothing was persisted (older runs).
                      const ids = row.original.last_failed_connection_ids ?? []
                      if (ids.length > 0) {
                        run(row.original.id, { connection_ids: ids })
                      } else {
                        handleRunJob(row.original)
                      }
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
  const selectedJob = selected ? (jobs.find((job) => job.id === selected.id) ?? selected) : null

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
            getRowStyle={(row) => getJobRowTintStyle(row.original)}
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

      {/* Create / Edit Form — mount only while open so the dialog renders cleanly */}
      {formOpen && (
        <JobForm
          key={formMode === 'edit' && selected ? `job-${selected.id}` : 'create'}
          isOpen
          onOpenChange={setFormOpen}
          mode={formMode}
          data={selectedJob ? { ...selectedJob, schedule_raw: selectedJob.schedule } : undefined}
          onSubmit={handleFormSubmit}
        />
      )}

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

      {/* Variables panel */}
      {varPanelJob && (
        <JobVariablesPanel
          isOpen={!!varPanelJob}
          onOpenChange={(o) => {
            if (!o && isMountedRef.current) setVarPanelJob(null)
          }}
          jobId={varPanelJob.id}
          jobName={varPanelJob.name}
          jobRemoteId={varPanelJob.remote_id}
          canEdit={canEditJobVariables(varPanelJob.remote_id)}
          connections={connections.filter((c) => varPanelJob.connection_ids.includes(c.id))}
        />
      )}
    </div>
  )
}
