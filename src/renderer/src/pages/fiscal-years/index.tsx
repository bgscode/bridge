import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, Plus } from 'lucide-react'
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
import type { FiscalYearRow } from '@shared/index'

// ─── Form Schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, 'Name is required')
})
type FormValues = z.infer<typeof schema>

// ─── Form Dialog ──────────────────────────────────────────────────────────────

function FiscalYearForm({
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
    defaultValues: { name: '', ...data }
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
          <DialogTitle>{mode === 'create' ? 'New Fiscal Year' : 'Edit Fiscal Year'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Add a new fiscal year.' : 'Update fiscal year name.'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">
                Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="name" placeholder="e.g. 2025-26" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FiscalYearsPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<FiscalYearRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FiscalYearRow | null>(null)

  useEffect(() => {
    window.api.fiscalYears.getAll().then(setFiscalYears)
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate() {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(fy: FiscalYearRow) {
    setSelected(fy)
    setFormMode('edit')
    setFormOpen(true)
  }

  async function handleDuplicate(fy: FiscalYearRow) {
    const created = (await window.api.fiscalYears.create({
      name: `${fy.name} (Copy)`
    })) as FiscalYearRow
    setFiscalYears((prev) => [created, ...prev])
  }

  async function handleSubmit(values: FormValues) {
    if (formMode === 'create') {
      const created = (await window.api.fiscalYears.create(values)) as FiscalYearRow
      setFiscalYears((prev) => [created, ...prev])
    } else if (selected) {
      const updated = (await window.api.fiscalYears.update(selected.id, values)) as FiscalYearRow
      setFiscalYears((prev) => prev.map((f) => (f.id === selected.id ? updated : f)))
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    await window.api.fiscalYears.delete(deleteTarget.id)
    setFiscalYears((prev) => prev.filter((f) => f.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  // ── Column Definitions ─────────────────────────────────────────────────────

  const columns = useMemo<DataGridColumnDef<FiscalYearRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.name}
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
              <CalendarRange className="size-4 text-muted-foreground" />
              Fiscal Years
            </CardTitle>
            <CardDescription className="text-sm">Manage fiscal year periods.</CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            New Fiscal Year
          </Button>
        </CardHeader>

        <Separator />

        {/* DataGrid */}
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<FiscalYearRow>
            data={fiscalYears}
            columns={columns}
            persistStateKey="fiscal-years-grid"
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
                  <CalendarRange className="size-8 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">No fiscal years yet</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Add your first fiscal year to get started.
                  </p>
                </div>
                <Button size="sm" onClick={handleCreate} className="gap-2">
                  <Plus className="size-4" />
                  New Fiscal Year
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <FiscalYearForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={selected ?? undefined}
        onSubmit={handleSubmit}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Fiscal Year"
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
