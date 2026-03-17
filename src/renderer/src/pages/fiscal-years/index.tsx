import { useEffect, useState } from 'react'
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CalendarRange className="size-4 text-muted-foreground" />
              Fiscal Years
            </CardTitle>
            <CardDescription className="text-sm">Manage fiscal year periods.</CardDescription>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => {
              setSelected(null)
              setFormMode('create')
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" /> New Fiscal Year
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {fiscalYears.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <CalendarRange className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No fiscal years yet. Create one to get started.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setSelected(null)
                  setFormMode('create')
                  setFormOpen(true)
                }}
              >
                <Plus className="size-4 mr-1" /> New Fiscal Year
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fiscalYears.map((fy) => (
                  <TableRow key={fy.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {fy.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fy.created_at}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setSelected(fy)
                            setFormMode('edit')
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(fy)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FiscalYearForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={selected ?? undefined}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-destructive" /> Delete Fiscal Year
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">"{deleteTarget?.name}"</span>? This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
