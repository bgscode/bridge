import { JSX, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { Download, Layers, Plus, Trash2 } from 'lucide-react'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { GroupRow } from '@shared/index'
import { useGroups } from '@/contexts'
import { GroupForm, type GroupFormValues } from './components/form'
import { downloadGroupTemplate } from './utils/template'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GroupsPage(): JSX.Element {
  const { groups, create, update, remove, removeMany, bulkCreate } = useGroups()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<GroupRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate(): void {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(group: GroupRow): void {
    setSelected(group)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleFormSubmit(values: GroupFormValues): void {
    if (formMode === 'create') {
      create(values)
    } else if (selected) {
      update(selected.id, values)
    }
  }

  function handleDuplicate(group: GroupRow): void {
    create({ name: `${group.name} (Copy)`, description: group.description })
  }

  function handleDeleteConfirm(): void {
    if (!deleteTarget) return
    remove(deleteTarget.id).then(() => setDeleteTarget(null))
  }

  function handleBulkDelete(): void {
    const ids = groups.filter((g) => rowSelection[String(g.id)]).map((g) => g.id)
    removeMany(ids).then(() => {
      setRowSelection({})
      setBulkDeleteOpen(false)
    })
  }

  function handleBulkUpload(rows: Record<string, unknown>[]): void {
    if (rows.length === 0) {
      toast.error('File is empty — no rows found.')
      return
    }

    const fileKeys = Object.keys(rows[0]).map((k) => k.trim().toLowerCase())
    if (!fileKeys.includes('name')) {
      toast.error('Missing required column: name', {
        description: 'Download the template and use the correct column headers.'
      })
      return
    }

    const errors: string[] = []
    const dtos = rows
      .map((r, i) => {
        const row = i + 2
        const name = String(r.name ?? '').trim()
        if (!name) {
          errors.push(`Row ${row}: name is empty`)
          return null
        }
        return { name, description: r.description ? String(r.description).trim() : null }
      })
      .filter(Boolean) as { name: string; description: string | null }[]

    if (errors.length > 0 && dtos.length === 0) {
      toast.error(`All ${rows.length} row(s) have errors`, {
        description: errors.slice(0, 5).join('\n')
      })
      return
    }

    if (errors.length > 0) {
      toast.warning(
        `${errors.length} row(s) skipped due to missing name. Importing ${dtos.length} valid row(s).`
      )
    }

    bulkCreate(dtos)
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: DataGridColumnDef<GroupRow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <Badge variant="outline">{row.original.name}</Badge>,
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
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.created_at}</span>
      ),
      meta: { filterType: 'date', resizable: true }
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedCount = Object.keys(rowSelection).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-muted-foreground" />
              Groups
            </CardTitle>
            <CardDescription className="text-sm">Manage connection groups.</CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            New Group
          </Button>
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<GroupRow>
            data={groups}
            columns={columns}
            persistStateKey="groups-grid"
            selectionMode="multiple"
            className="flex-1 rounded-none border-0"
            enableColumnResizing={true}
            getRowId={(row) => String(row.id)}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            onImport={handleBulkUpload}
            toolbar={{
              showSearch: true,
              showExport: true,
              showImport: true,
              showColumnToggle: true,
              showFilterPanel: true,
              showDensityToggle: true,
              customActions: (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={downloadGroupTemplate}
                  >
                    <Download className="size-4" />
                    Template
                  </Button>
                  {selectedCount > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" />
                      Delete ({selectedCount})
                    </Button>
                  )}
                </>
              )
            }}
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
                  <Layers className="size-8 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">No groups yet</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Add your first group to get started.
                  </p>
                </div>
                <Button size="sm" onClick={handleCreate} className="gap-2">
                  <Plus className="size-4" />
                  New Group
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <GroupForm
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
        title="Delete Group"
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">&quot;{deleteTarget?.name}&quot;</span>?
            This action cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedCount} Group(s)`}
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">{selectedCount} selected group(s)</span>?
            This action cannot be undone.
          </>
        }
        confirmLabel={`Delete ${selectedCount}`}
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}
