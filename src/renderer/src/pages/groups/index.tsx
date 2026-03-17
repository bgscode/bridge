import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import type { GroupRow } from '@shared/index'

// ─── Form Schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional()
})
type FormValues = z.infer<typeof schema>

// ─── Form Dialog ──────────────────────────────────────────────────────────────

function GroupForm({
  isOpen,
  onOpenChange,
  mode,
  data,
  onSubmit
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  data?: Partial<FormValues>
  onSubmit: (values: FormValues) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', ...data }
  })

  function onValid(values: FormValues) {
    onSubmit(values)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Group' : 'Edit Group'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Add a new connection group.' : 'Update group details.'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">
                Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="name" placeholder="e.g. Head Office" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Input
                id="description"
                placeholder="Optional description"
                {...register('description')}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create Group' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<GroupRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null)

  useEffect(() => {
    window.api.groups.getAll().then(setGroups)
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate() {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(group: GroupRow) {
    setSelected(group)
    setFormMode('edit')
    setFormOpen(true)
  }

  async function handleDuplicate(group: GroupRow) {
    const created = (await window.api.groups.create({
      name: `${group.name} (Copy)`,
      description: group.description
    })) as GroupRow
    setGroups((prev) => [created, ...prev])
  }

  async function handleSubmit(values: FormValues) {
    if (formMode === 'create') {
      const created = (await window.api.groups.create(values)) as GroupRow
      setGroups((prev) => [created, ...prev])
    } else if (selected) {
      const updated = (await window.api.groups.update(selected.id, values)) as GroupRow
      setGroups((prev) => prev.map((g) => (g.id === selected.id ? updated : g)))
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    await window.api.groups.delete(deleteTarget.id)
    setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  // ── Column Definitions ─────────────────────────────────────────────────────

  const columns = useMemo<DataGridColumnDef<GroupRow>[]>(
    () => [
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
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

        {/* DataGrid */}
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<GroupRow>
            data={groups}
            columns={columns}
            persistStateKey="groups-grid"
            selectionMode="multiple"
            className="flex-1 rounded-none border-0"
            enableColumnResizing={true}
            toolbar={{
              showSearch: true,
              showExport: true,
              showColumnToggle: true,
              showFilterPanel: true,
              showDensityToggle: true
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

      {/* Form Dialog */}
      <GroupForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={
          selected
            ? { name: selected.name, description: selected.description ?? undefined }
            : undefined
        }
        onSubmit={handleSubmit}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Group"
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">"{deleteTarget?.name}"</span>? This action
            cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
