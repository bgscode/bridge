import { JSX, useEffect, useState, type FormEvent } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Loader2Icon, PlusIcon, Trash2, Users as UsersIcon } from 'lucide-react'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { usersApi, type AdminUserInput, type AdminUserUpdate, type AuthUser } from '@/lib/api'
import { AssignmentsDialog } from './team/assignments-dialog'
import { UserCog2Icon } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

export default function TeamPage(): JSX.Element {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<AuthUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignTarget, setAssignTarget] = useState<AuthUser | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setUsers(await usersApi.list())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (me?.role === 'admin') void load()
    else setLoading(false)
  }, [me?.role])

  if (me?.role !== 'admin') {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-muted-foreground">Only administrators can manage team members.</p>
      </div>
    )
  }

  function handleCreate(): void {
    setSelected(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(u: AuthUser): void {
    setSelected(u)
    setFormMode('edit')
    setFormOpen(true)
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return
    try {
      await usersApi.remove(deleteTarget.id)
      toast.success(`Deleted ${deleteTarget.name}`)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleBulkDelete(): Promise<void> {
    if (!me) return
    const ids = users.filter((u) => rowSelection[u.id] && u.id !== me.id).map((u) => u.id)
    try {
      await Promise.all(ids.map((id) => usersApi.remove(id)))
      toast.success(`Deleted ${ids.length} user${ids.length === 1 ? '' : 's'}`)
      setRowSelection({})
      setBulkDeleteOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed')
    }
  }

  const columns: DataGridColumnDef<AuthUser>[] = [
    {
      accessorKey: 'userId',
      header: 'User ID',
      cell: ({ row }) => <Badge variant="outline">{row.original.userId}</Badge>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.phone}</span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.email ?? '—'}</span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <Badge variant={row.original.role === 'admin' ? 'default' : 'secondary'}>
          {row.original.role}
        </Badge>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </span>
      ),
      meta: { resizable: true }
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
            onDelete={row.original.id !== me.id ? () => setDeleteTarget(row.original) : undefined}
            extraItems={
              row.original.id !== me.id ? (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setAssignTarget(row.original)
                    setAssignOpen(true)
                  }}
                >
                  <UserCog2Icon className="size-4 mr-2" />
                  Assign access
                </DropdownMenuItem>
              ) : undefined
            }
          />
        </div>
      )
    }
  ]

  const selectedCount = Object.keys(rowSelection).filter((id) => id !== me.id).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <UsersIcon className="size-4 text-muted-foreground" />
              Team
            </CardTitle>
            <CardDescription className="text-sm">
              Manage team members. Users can sign in with their User ID, phone, or email.
            </CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <PlusIcon className="size-4" />
            New member
          </Button>
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataGrid<AuthUser>
              data={users}
              columns={columns}
              persistStateKey="team-grid"
              selectionMode="multiple"
              className="flex-1 rounded-none border-0"
              enableColumnResizing={true}
              getRowId={(row) => row.id}
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
          )}
        </CardContent>
      </Card>

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initial={selected}
        onSaved={async () => {
          setFormOpen(false)
          await load()
        }}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="This action cannot be undone. The user will lose all access."
        onConfirm={handleDeleteConfirm}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedCount} users?`}
        description="This action cannot be undone."
        onConfirm={handleBulkDelete}
      />

      <AssignmentsDialog user={assignTarget} open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  )
}

// ── User form (create + edit) ──────────────────────────────────────────────

interface UserFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial: AuthUser | null
  onSaved: () => void | Promise<void>
}

function UserFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSaved
}: UserFormProps): JSX.Element {
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initial) {
      setUserId(initial.userId)
      setName(initial.name)
      setPhone(initial.phone)
      setEmail(initial.email ?? '')
      setRole(initial.role)
      setPassword('')
    } else {
      setUserId('')
      setName('')
      setPhone('')
      setEmail('')
      setPassword('')
      setRole('user')
    }
  }, [open, mode, initial])

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'create') {
        const payload: AdminUserInput = {
          userId,
          name,
          phone,
          email: email.trim() || undefined,
          password,
          role
        }
        await usersApi.create(payload)
        toast.success('User created')
      } else if (initial) {
        const payload: AdminUserUpdate = {
          userId,
          name,
          phone,
          email: email.trim() || undefined,
          role
        }
        if (password) payload.password = password
        await usersApi.update(initial.id, payload)
        toast.success('User updated')
      }
      await onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'New team member' : 'Edit team member'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="f-userId">User ID</Label>
              <Input
                id="f-userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                minLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-name">Name</Label>
              <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="f-phone">Phone</Label>
              <Input
                id="f-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                minLength={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-email">
                Email <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="f-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="f-password">
              {mode === 'create' ? 'Password' : 'New password (leave blank to keep)'}
            </Label>
            <PasswordInput
              id="f-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={mode === 'create'}
              minLength={mode === 'create' ? 8 : 0}
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'user')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {mode === 'create' ? 'Create user' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
