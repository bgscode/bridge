import { JSX, useEffect, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { Database, Download, KeyRound, Plus, Trash2, Wifi } from 'lucide-react'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'

import { DataGrid, type DataGridColumnDef } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Separator } from '@/components/ui/separator'
import { ConnectionForm, type ConnectionFormValues } from './components/form'
import { BulkCredentialsDialog } from './components/bulk-credentials-dialog'
import { ConnectionRow } from '@shared/index'
import { toast } from 'sonner'
import { useConnections, useGroups, useStores, useFiscalYears } from '@/contexts'
import { useAuth } from '@/contexts/auth-context'
import { downloadConnectionTemplate } from './utils/template'
import { StatusBadge } from './components/status-badge'
import { formatUtcToIst } from '@renderer/lib/utils'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ConnectionPage(): JSX.Element {
  const { connections, create, update, remove, removeMany, bulkCreate, bulkUpdateCredentials, updateStatus, reload } =
    useConnections()
  const { groups, reload: reloadGroups } = useGroups()
  const { stores, reload: reloadStores } = useStores()
  const { fiscalYears, reload: reloadFiscalYears } = useFiscalYears()
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [selectedConnection, setSelectedConnection] = useState<ConnectionRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectionRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkCredsOpen, setBulkCredsOpen] = useState(false)

  // ── Test Progress Listener ────────────────────────────────────────────────

  useEffect(() => {
    window.api.connections.onTestProgress((data) => {
      updateStatus(data.id, data.status)
    })
    return () => window.api.connections.offTestProgress()
  }, [updateStatus])

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleTestAll(): Promise<void> {
    const ids = connections.map((c) => c.id)
    ids.forEach((id) => updateStatus(id, 'testing'))
    await window.api.connections.testAll(ids)
    // Refresh rows from DB so updated_at reflects actual test completion time.
    reload()
  }

  async function handleTestOne(id: number): Promise<void> {
    updateStatus(id, 'testing')
    await window.api.connections.test(id)
    // Refresh row from DB so updated_at reflects actual test completion time.
    reload()
  }

  function handleCreate(): void {
    setSelectedConnection(null)
    setFormMode('create')
    setFormOpen(true)
  }

  function handleEdit(connection: ConnectionRow): void {
    setSelectedConnection(connection)
    setFormMode('edit')
    setFormOpen(true)
  }

  function handleDeleteConfirm(): void {
    if (!deleteTarget) return
    remove(deleteTarget.id).then(() => setDeleteTarget(null))
  }

  function handleBulkDelete(): void {
    const ids = connections.filter((c) => rowSelection[String(c.id)]).map((c) => c.id)
    removeMany(ids).then(() => {
      setRowSelection({})
      setBulkDeleteOpen(false)
    })
  }

  function handleDuplicate(connection: ConnectionRow): void {
    create({
      name: `${connection.name} (Copy)`,
      group_id: connection.group_id,
      static_ip: connection.static_ip,
      vpn_ip: connection.vpn_ip,
      db_name: connection.db_name,
      username: connection.username,
      password: connection.password,
      trust_cert: connection.trust_cert,
      fiscal_year_id: connection.fiscal_year_id,
      store_id: connection.store_id,
      status: 'unknown'
    })
  }

  function handleFormSubmit(values: ConnectionFormValues): void {
    const dto = {
      ...values,
      trust_cert: values.trust_cert ? 1 : 0,
      group_id: values.group_id ?? null,
      store_id: values.store_id ?? null,
      fiscal_year_id: values.fiscal_year_id ?? null,
      status: 'unknown' as const
    }
    if (formMode === 'create') {
      create(dto)
    } else if (selectedConnection) {
      update(selectedConnection.id, dto)
    }
  }

  async function handleBulkUpload(items: Record<string, unknown>[]): Promise<void> {
    if (items.length === 0) {
      toast.error('File is empty — no rows found.')
      return
    }

    const requiredCols = ['name', 'static_ip', 'db_name', 'username'] as const
    const fileKeys = Object.keys(items[0]).map((k) => k.trim().toLowerCase())
    const missingCols = requiredCols.filter((col) => !fileKeys.includes(col))

    if (missingCols.length > 0) {
      toast.error(`Missing required columns: ${missingCols.join(', ')}`, {
        description: 'Download the template and use the correct column headers.'
      })
      return
    }

    // ── Name → ID resolution caches (case-insensitive) ─────────────────────
    const groupCache = new Map<string, number>()
    for (const g of groups) groupCache.set(g.name.toLowerCase(), g.id)

    const storeCache = new Map<string, number>()
    for (const s of stores) storeCache.set(s.name.toLowerCase(), s.id)

    const fyCache = new Map<string, number>()
    for (const f of fiscalYears) fyCache.set(f.name.toLowerCase(), f.id)

    async function resolveGroupId(value: unknown): Promise<number | null> {
      if (value == null || value === '') return null
      const str = String(value).trim()
      if (!str) return null
      if (!isNaN(Number(str))) return Number(str)
      const key = str.toLowerCase()
      if (groupCache.has(key)) return groupCache.get(key)!
      const created = await window.api.groups.create({ name: str, description: null })
      groupCache.set(key, created.id)
      return created.id
    }

    async function resolveStoreId(value: unknown): Promise<number | null> {
      if (value == null || value === '') return null
      const str = String(value).trim()
      if (!str) return null
      if (!isNaN(Number(str))) return Number(str)
      const key = str.toLowerCase()
      if (storeCache.has(key)) return storeCache.get(key)!
      const created = await window.api.stores.create({ name: str, code: str })
      storeCache.set(key, created.id)
      return created.id
    }

    async function resolveFiscalYearId(value: unknown): Promise<number | null> {
      if (value == null || value === '') return null
      const str = String(value).trim()
      if (!str) return null
      if (!isNaN(Number(str))) return Number(str)
      const key = str.toLowerCase()
      if (fyCache.has(key)) return fyCache.get(key)!
      const created = await window.api.fiscalYears.create({ name: str })
      fyCache.set(key, created.id)
      return created.id
    }

    // ── Build DTOs with auto-resolution ─────────────────────────────────────
    const errors: string[] = []
    const dtos: Parameters<typeof bulkCreate>[0] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const row = i + 2
      const name = String(item.name ?? '').trim()
      const static_ip = String(item.static_ip ?? '').trim()
      const db_name = String(item.db_name ?? '').trim()
      const username = String(item.username ?? '').trim()

      if (!name) errors.push(`Row ${row}: name is empty`)
      if (!static_ip) errors.push(`Row ${row}: static_ip is empty`)
      if (!db_name) errors.push(`Row ${row}: db_name is empty`)
      if (!username) errors.push(`Row ${row}: username is empty`)
      if (!name || !static_ip || !db_name || !username) continue

      const group_id = await resolveGroupId(item.group_id)
      const store_id = await resolveStoreId(item.store_id)
      const fiscal_year_id = await resolveFiscalYearId(item.fiscal_year_id)

      dtos.push({
        name,
        group_id,
        static_ip,
        vpn_ip: String(item.vpn_ip ?? '').trim(),
        db_name,
        username,
        password: String(item.password ?? ''),
        trust_cert: Number(item.trust_cert ?? 0),
        fiscal_year_id,
        store_id,
        status: 'unknown' as const
      })
    }

    if (errors.length > 0 && dtos.length === 0) {
      toast.error(`All ${items.length} row(s) have errors`, {
        description: errors.slice(0, 5).join('\n')
      })
      return
    }

    if (errors.length > 0) {
      toast.warning(
        `${errors.length} row(s) skipped due to missing required fields. Importing ${dtos.length} valid row(s).`
      )
    }

    bulkCreate(dtos).then(() => {
      reloadGroups()
      reloadStores()
      reloadFiscalYears()
    })
  }

  function handleDownloadTemplate(): void {
    downloadConnectionTemplate(groups, stores, fiscalYears)
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function mapExportRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row) => ({
      name: String(row.name ?? ''),
      static_ip: String(row.static_ip ?? ''),
      vpn_ip: String(row.vpn_ip ?? ''),
      db_name: String(row.db_name ?? ''),
      username: String(row.username ?? ''),
      password: String(row.password ?? ''),
      trust_cert: Number(row.trust_cert ?? 0),
      group_id:
        row.group_id != null && row.group_id !== ''
          ? (groups.find((g) => g.id === Number(row.group_id))?.name ?? String(row.group_id))
          : '',
      fiscal_year_id:
        row.fiscal_year_id != null && row.fiscal_year_id !== ''
          ? (fiscalYears.find((f) => f.id === Number(row.fiscal_year_id))?.name ??
            String(row.fiscal_year_id))
          : '',
      store_id:
        row.store_id != null && row.store_id !== ''
          ? (stores.find((s) => s.id === Number(row.store_id))?.name ?? String(row.store_id))
          : '',
      status: String(row.status ?? ''),
      last_tested: formatUtcToIst(row.updated_at)
    }))
  }

  async function handleExport(
    format: 'csv' | 'excel',
    rows: Record<string, unknown>[],
    selectedOnly: boolean
  ): Promise<void> {
    const exportRows = mapExportRows(rows)
    const filename = selectedOnly ? 'connections-selected' : 'connections'

    if (format === 'csv') {
      const csv = Papa.unparse(exportRows)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      downloadBlob(blob, `${filename}.csv`)
      return
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Bridge App'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('Connections', {
      views: [{ state: 'frozen', ySplit: 1 }]
    })

    const defaultExportRow: Record<string, unknown> = {
      name: '',
      static_ip: '',
      vpn_ip: '',
      db_name: '',
      username: '',
      password: '',
      trust_cert: 0,
      group_id: '',
      fiscal_year_id: '',
      store_id: '',
      status: '',
      last_tested: ''
    }

    const headers = Object.keys(exportRows[0] ?? defaultExportRow)

    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(header.length + 4, 14)
    }))

    exportRows.forEach((row) => {
      sheet.addRow(headers.map((header) => row[header] ?? ''))
    })

    const headerRow = sheet.getRow(1)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    downloadBlob(blob, `${filename}.xlsx`)
  }

  // ── Column Definitions ─────────────────────────────────────────────────────

  const columns: DataGridColumnDef<ConnectionRow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'group_id',
      header: 'Group',
      cell: ({ row }) =>
        row.original.group_id != null ? (
          <Badge variant="outline" className="text-xs font-normal">
            {groups.find((g) => g.id === row.original.group_id)?.name ??
              `Group ${row.original.group_id}`}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'static_ip',
      header: 'Static IP',
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.static_ip}</span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'vpn_ip',
      header: 'VPN IP',
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.vpn_ip}</span>
      ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'db_name',
      header: 'Database',
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.db_name}</span>,
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'fiscal_year_id',
      header: 'Financial Year',
      cell: ({ row }) =>
        row.original.fiscal_year_id != null ? (
          <span className="text-sm">
            {fiscalYears.find((f) => f.id === row.original.fiscal_year_id)?.name ??
              `FY ${row.original.fiscal_year_id}`}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'store_id',
      header: 'Store',
      cell: ({ row }) =>
        row.original.store_id != null ? (
          <span className="text-sm">
            {stores.find((s) => s.id === row.original.store_id)?.name ??
              `Store ${row.original.store_id}`}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      meta: { filterType: 'text', resizable: true }
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      meta: {
        filterType: 'select',
        filterOptions: [
          { label: 'Online', value: 'online' },
          { label: 'Offline', value: 'offline' },
          { label: 'Unknown', value: 'unknown' },
          { label: 'Failed', value: 'failed' }
        ],
        resizable: true
      }
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
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
            onEdit={isAdmin ? () => handleEdit(row.original) : undefined}
            onDuplicate={isAdmin ? () => handleDuplicate(row.original) : undefined}
            onDelete={isAdmin ? () => setDeleteTarget(row.original) : undefined}
            extraItems={
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleTestOne(row.original.id)
                }}
              >
                <Wifi className="size-4" />
                Test Connection
              </DropdownMenuItem>
            }
          />
        </div>
      )
    }
  ]

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
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <Button size="sm" className="gap-2" onClick={handleCreate}>
                <Plus className="size-4" />
                New Connection
              </Button>
            )}
          </div>
        </CardHeader>

        <Separator />

        {/* DataGrid */}
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataGrid<ConnectionRow>
            data={connections}
            columns={columns}
            persistStateKey="connections-grid"
            selectionMode="multiple"
            className="flex-1 rounded-none border-0"
            enableColumnResizing={true}
            getRowId={(row) => String(row.id)}
            onImport={isAdmin ? (row) => handleBulkUpload(row) : undefined}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            toolbar={{
              showSearch: true,
              showExport: isAdmin,
              showImport: isAdmin,
              showColumnToggle: true,
              showFilterPanel: true,
              showDensityToggle: true,
              customActions: (() => {
                const selectedCount = Object.keys(rowSelection).length
                return (
                  <>
                    <Button variant="outline" size="sm" className="gap-2" onClick={handleTestAll}>
                      <Wifi className="size-4" />
                      Test All
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleDownloadTemplate}
                      >
                        <Download className="size-4" />
                        Template
                      </Button>
                    )}
                    {isAdmin && selectedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setBulkCredsOpen(true)}
                      >
                        <KeyRound className="size-4" />
                        Update Credentials ({selectedCount})
                      </Button>
                    )}
                    {isAdmin && selectedCount > 0 && (
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
              })()
            }}
            onExport={isAdmin ? handleExport : undefined}
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
                  <Database className="size-8 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">No connections yet</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    {isAdmin
                      ? 'Add your first database connection to get started.'
                      : 'Your admin will assign connections to you once available.'}
                  </p>
                </div>
                {isAdmin && (
                  <Button size="sm" onClick={handleCreate} className="gap-2">
                    <Plus className="size-4" />
                    New Connection
                  </Button>
                )}
              </div>
            )}
          />
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
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Connection"
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground"> &quot;{deleteTarget?.name}&quot; </span>?
            This action cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${Object.keys(rowSelection).length} Connection(s)`}
        description={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">
              {Object.keys(rowSelection).length} selected connection(s)
            </span>
            ? This action cannot be undone.
          </>
        }
        confirmLabel={`Delete ${Object.keys(rowSelection).length}`}
        onConfirm={handleBulkDelete}
      />

      {/* Bulk Update Credentials Dialog */}
      <BulkCredentialsDialog
        open={bulkCredsOpen}
        onOpenChange={setBulkCredsOpen}
        count={Object.keys(rowSelection).length}
        onSubmit={async (creds) => {
          const ids = connections
            .filter((c) => rowSelection[String(c.id)])
            .map((c) => c.id)
          if (ids.length === 0) return
          await bulkUpdateCredentials(ids, creds)
          setRowSelection({})
        }}
      />
    </div>
  )
}
