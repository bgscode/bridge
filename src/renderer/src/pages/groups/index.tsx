import { useEffect, useState } from 'react'
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react'
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
          <Button
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => {
              setSelected(null)
              setFormMode('create')
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" /> New Group
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Layers className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No groups yet. Create one to get started.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setSelected(null)
                  setFormMode('create')
                  setFormOpen(true)
                }}
              >
                <Plus className="size-4 mr-1" /> New Group
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">
                      <Badge variant="outline">{group.name}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {group.description || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {group.created_at}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setSelected(group)
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
                          onClick={() => setDeleteTarget(group)}
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

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-destructive" /> Delete Group
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
