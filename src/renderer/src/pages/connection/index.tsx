import { useState } from 'react'
import { Database, Pencil, Plus, ServerCrash, Trash2, Wifi, WifiOff } from 'lucide-react'

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
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

import { ConnectionForm, type ConnectionFormValues } from './components/form'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Connection extends ConnectionFormValues {
  id: string
  status: 'online' | 'offline' | 'unknown'
  createdAt: string
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_CONNECTIONS: Connection[] = [
  {
    id: '1',
    name: 'Head Office Production',
    staticIp: '192.168.1.100',
    vpnIp: '10.8.0.1',
    database: 'company_hq',
    username: 'sa',
    password: '',
    trustServerCertificate: true,
    store: 'Main Store',
    financialYear: '2024-25',
    group: 'Head Office',
    status: 'online',
    createdAt: '2025-01-10'
  },
  {
    id: '2',
    name: 'Branch Delhi',
    staticIp: '192.168.2.50',
    vpnIp: '10.8.0.5',
    database: 'company_delhi',
    username: 'sa',
    password: '',
    trustServerCertificate: false,
    store: '',
    financialYear: '2024-25',
    group: 'Branch',
    status: 'offline',
    createdAt: '2025-02-14'
  },
  {
    id: '3',
    name: 'Warehouse Noida',
    staticIp: '192.168.3.10',
    vpnIp: '10.8.0.12',
    database: 'warehouse_noida',
    username: 'admin',
    password: '',
    trustServerCertificate: true,
    store: 'WH-01',
    financialYear: '2025-26',
    group: 'Warehouse',
    status: 'unknown',
    createdAt: '2025-03-05'
  }
]

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Connection['status'] }) {
  if (status === 'online') {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500">
        <Wifi className="size-3" />
        Online
      </Badge>
    )
  }
  if (status === 'offline') {
    return (
      <Badge variant="destructive" className="gap-1">
        <WifiOff className="size-3" />
        Offline
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <ServerCrash className="size-3" />
      Unknown
    </Badge>
  )
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <Database className="size-8 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">No connections yet</h3>
        <p className="max-w-xs text-sm text-muted-foreground">
          Add your first database connection to get started.
        </p>
      </div>
      <Button size="sm" onClick={onCreateClick} className="gap-2">
        <Plus className="size-4" />
        New Connection
      </Button>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ConnectionPage() {
  const [connections, setConnections] = useState<Connection[]>(MOCK_CONNECTIONS)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null)

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate() {
    setSelectedConnection(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(connection: Connection) {
    setSelectedConnection(connection)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleDeleteClick(connection: Connection) {
    setDeleteTarget(connection)
  }

  function handleDeleteConfirm() {
    if (deleteTarget) {
      setConnections((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      setDeleteTarget(null)
    }
  }

  function handleFormSubmit(values: ConnectionFormValues) {
    if (formMode === 'create') {
      const newConnection: Connection = {
        ...values,
        id: crypto.randomUUID(),
        status: 'unknown',
        createdAt: new Date().toISOString().split('T')[0]
      }
      setConnections((prev) => [...prev, newConnection])
    } else if (selectedConnection) {
      setConnections((prev) =>
        prev.map((c) => (c.id === selectedConnection.id ? { ...c, ...values } : c))
      )
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Database className="size-4 text-muted-foreground" />
              Connections
            </CardTitle>
            <CardDescription className="text-sm">
              Manage your database connections across all branches and sites.
            </CardDescription>
          </div>

          <Button size="sm" className="shrink-0 gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            New Connection
          </Button>
        </CardHeader>

        <Separator />

        {/* Body */}
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {connections.length === 0 ? (
            <EmptyState onCreateClick={handleCreate} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Static IP</TableHead>
                  <TableHead>VPN IP</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Financial Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id}>
                    <TableCell className="font-medium">{conn.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal">
                        {conn.group}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {conn.staticIp}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {conn.vpnIp}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{conn.database}</TableCell>
                    <TableCell className="text-sm">{conn.financialYear}</TableCell>
                    <TableCell>
                      <StatusBadge status={conn.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleEdit(conn)}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClick(conn)}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete</span>
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

      {/* Form Dialog */}
      <ConnectionForm
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        data={selectedConnection ?? undefined}
        onSubmit={handleFormSubmit}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="size-4 text-destructive" />
              Delete Connection
            </DialogTitle>
            <DialogDescription className="text-sm">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">"{deleteTarget?.name}"</span>? This
              action cannot be undone.
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
