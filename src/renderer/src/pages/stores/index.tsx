import { useEffect, useState } from 'react'
import { Store, Pencil, Plus, Trash2 } from 'lucide-react'
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
import type { StoreRow } from '@shared/index'

// ─── Form Schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Code is required')
})
type FormValues = z.infer<typeof schema>

// ─── Form Dialog ──────────────────────────────────────────────────────────────

function StoreForm({
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
    defaultValues: { name: '', code: '', ...data }
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
          <DialogTitle>{mode === 'create' ? 'New Store' : 'Edit Store'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Add a new store.' : 'Update store details.'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">
                Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="name" placeholder="e.g. Main Store" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="code">
                Code <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="code" placeholder="e.g. STR-001" {...register('code')} />
              <FieldError errors={[errors.code]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create Store' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<StoreRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)

  useEffect(() => {
    window.api.stores.getAll().then(setStores)
  }, [])

  async function handleSubmit(values: FormValues) {
    if (formMode === 'create') {
      const created = (await window.api.stores.create(values)) as StoreRow
      setStores((prev) => [created, ...prev])
    } else if (selected) {
      const updated = (await window.api.stores.update(selected.id, values)) as StoreRow
      setStores((prev) => prev.map((s) => (s.id === selected.id ? updated : s)))
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    await window.api.stores.delete(deleteTarget.id)
    setStores((prev) => prev.filter((s) => s.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

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
          <Button
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => {
              setSelected(null)
              setFormMode('create')
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" /> New Store
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {stores.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Store className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No stores yet. Create one to get started.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setSelected(null)
                  setFormMode('create')
                  setFormOpen(true)
                }}
              >
                <Plus className="size-4 mr-1" /> New Store
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">{store.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {store.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {store.created_at}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setSelected(store)
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
                          onClick={() => setDeleteTarget(store)}
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

      <StoreForm
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
              <Trash2 className="size-4 text-destructive" /> Delete Store
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
