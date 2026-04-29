import { JSX, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { Download, Plus, Store, Trash2 } from 'lucide-react'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { StoreRow } from '@shared/index'
import { useStores } from '@/contexts'
import { StoreForm, type StoreFormValues } from './components/form'
import { downloadStoreTemplate } from './utils/template'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoresPage(): JSX.Element {
  const { stores, create, update, remove, removeMany, bulkCreate } = useStores()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<StoreRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate(): void {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(store: StoreRow): void {
    setSelected(store)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleFormSubmit(values: StoreFormValues): void {
    if (formMode === 'create') {
      create(values)
    } else if (selected) {
      update(selected.id, values)
    }
  }

  function handleDuplicate(store: StoreRow): void {
    create({ name: `${store.name} (Copy)`, code: `${store.code}-COPY` })
  }

  function handleDeleteConfirm(): void {
    if (!deleteTarget) return
    remove(deleteTarget.id).then(() => setDeleteTarget(null))
  }

  function handleBulkDelete(): void {
    const ids = stores.filter((s) => rowSelection[String(s.id)]).map((s) => s.id)
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

    const requiredCols = ['name', 'code'] as const
    const fileKeys = Object.keys(rows[0]).map((k) => k.trim().toLowerCase())
    const missingCols = requiredCols.filter((col) => !fileKeys.includes(col))

    if (missingCols.length > 0) {
      toast.error(`Missing required columns: ${missingCols.join(', ')}`, {
        description: 'Download the template and use the correct column headers.'
      })
      return
    }

    const errors: string[] = []
    const dtos = rows
      .map((r, i) => {
        const row = i + 2
        const name = String(r.name ?? '').trim()
        const code = String(r.code ?? '').trim()
        if (!name) errors.push(`Row ${row}: name is empty`)
        if (!code) errors.push(`Row ${row}: code is empty`)
        if (!name || !code) return null
        return { name, code }
      })
      .filter(Boolean) as { name: string; code: string }[]

    if (errors.length > 0 && dtos.length === 0) {
      toast.error(`All ${rows.length} row(s) have errors`, {
        description: errors.slice(0, 5).join('\n')
      })
      return
    }

    if (errors.length > 0) {
      toast.warning(
        `${errors.length} row(s) skipped due to missing fields. Importing ${dtos.length} valid row(s).`
      )
    }

    bulkCreate(dtos)
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: DataGridColumnDef<StoreRow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {row.original.code}
        </Badge>
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
              <Store className="size-4 text-muted-foreground" />
              Stores
            </CardTitle>
            <CardDescription className="text-sm">Manage store locations.</CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            New Store
          </Button>
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<StoreRow>
            data={stores}
            columns={columns}
            persistStateKey="stores-grid"
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
                    onClick={downloadStoreTemplate}
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
                  <Store className="size-8 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">No stores yet</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Add your first store to get started.
                  </p>
                </div>
                <Button size="sm" onClick={handleCreate} className="gap-2">
                  <Plus className="size-4" />
                  New Store
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <StoreForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={selected ?? undefined}
        onSubmit={handleFormSubmit}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Store"
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
        title={`Delete ${selectedCount} Store(s)`}
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">{selectedCount} selected store(s)</span>?
            This action cannot be undone.
          </>
        }
        confirmLabel={`Delete ${selectedCount}`}
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}
