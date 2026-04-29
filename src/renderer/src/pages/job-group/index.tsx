import { JSX, useMemo, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { Layers, Plus, Trash2 } from 'lucide-react'
import type { JobGroupRow } from '@shared/index'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import { useJobGroups, useJobs } from '@/contexts'
import { JobGroupForm, type JobGroupFormValues } from './components/form'

export default function JobGroupPage(): JSX.Element {
  const { jobGroups, create, update, remove, removeMany } = useJobGroups()
  const { jobs } = useJobs()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<JobGroupRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JobGroupRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  function handleCreate(): void {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(group: JobGroupRow): void {
    setSelected(group)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleFormSubmit(values: JobGroupFormValues): void {
    if (formMode === 'create') {
      void create(values)
    } else if (selected) {
      void update(selected.id, values)
    }
  }

  function handleDuplicate(group: JobGroupRow): void {
    void create({ name: `${group.name} (Copy)`, description: group.description })
  }

  function handleDeleteConfirm(): void {
    if (!deleteTarget) return
    void remove(deleteTarget.id).then(() => setDeleteTarget(null))
  }

  function handleBulkDelete(): void {
    const ids = jobGroups.filter((g) => rowSelection[String(g.id)]).map((g) => g.id)
    void removeMany(ids).then(() => {
      setRowSelection({})
      setBulkDeleteOpen(false)
    })
  }

  const usageByGroupId = useMemo(() => {
    const map = new Map<number, number>()
    for (const job of jobs) {
      if (job.job_group_id == null) continue
      map.set(job.job_group_id, (map.get(job.job_group_id) ?? 0) + 1)
    }
    return map
  }, [jobs])

  const columns: DataGridColumnDef<JobGroupRow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <Badge variant="outline">{row.original.name}</Badge>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      id: 'usage',
      header: 'Jobs',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {usageByGroupId.get(row.original.id) ?? 0}
        </span>
      ),
      meta: { resizable: true }
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
            onEdit={() => handleEdit(row.original)}
            onDuplicate={() => handleDuplicate(row.original)}
            onDelete={() => setDeleteTarget(row.original)}
          />
        </div>
      )
    }
  ]

  const selectedCount = Object.keys(rowSelection).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-muted-foreground" />
              Job Groups
            </CardTitle>
            <CardDescription className="text-sm">
              Manage job groups separately from connection groups.
            </CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            New Job Group
          </Button>
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<JobGroupRow>
            data={jobGroups}
            columns={columns}
            persistStateKey="job-groups-grid"
            selectionMode="multiple"
            className="flex-1 rounded-none border-0"
            enableColumnResizing={true}
            getRowId={(row) => String(row.id)}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            toolbar={{
              showSearch: true,
              showExport: true,
              showColumnToggle: true,
              showFilterPanel: true,
              showDensityToggle: true,
              customActions:
                selectedCount > 0 ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete ({selectedCount})
                  </Button>
                ) : undefined
            }}
          />
        </CardContent>
      </Card>

      <JobGroupForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={
          selected
            ? { name: selected.name, description: selected.description ?? undefined }
            : undefined
        }
        onSubmit={handleFormSubmit}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Job Group"
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-semibold">{deleteTarget?.name}</span>?
          </>
        }
        onConfirm={handleDeleteConfirm}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete Selected Job Groups"
        description={
          <>
            Are you sure you want to delete <span className="font-semibold">{selectedCount}</span>{' '}
            selected job group{selectedCount !== 1 ? 's' : ''}?
          </>
        }
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}
