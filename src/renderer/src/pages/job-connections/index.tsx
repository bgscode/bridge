import { JSX, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Link2, Save } from 'lucide-react'

import { useAuth } from '@/contexts/auth-context'
import { useConnections, useFiscalYears, useGroups, useJobs, useStores } from '@/contexts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SelectBox } from '@/components/select-box'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  const normalized = values
    .map((value) => normalizeNumber(value))
    .filter((value): value is number => value !== null)

  return Array.from(new Set(normalized))
}

export default function JobConnectionsPage(): JSX.Element {
  const navigate = useNavigate()
  const { jobId } = useParams<{ jobId: string }>()
  const { user } = useAuth()
  const { jobs, updateConnections } = useJobs()
  const { connections } = useConnections()
  const { groups } = useGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<number[]>([])
  const [filterGroup, setFilterGroup] = useState<number | null>(null)
  const [filterStore, setFilterStore] = useState<number | null>(null)
  const [filterFiscalYear, setFilterFiscalYear] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const parsedJobId = Number(jobId)
  const job = Number.isInteger(parsedJobId) ? jobs.find((entry) => entry.id === parsedJobId) : null
  const isAdmin = user?.role === 'admin'
  const normalizedJobConnectionIds = normalizeNumberArray(job?.connection_ids ?? [])
  const isMultiQueryJob = job?.is_multi ?? false

  useEffect(() => {
    if (job) {
      const nextIds = normalizeNumberArray(job.connection_ids ?? [])
      setSelectedConnectionIds(job.is_multi ? nextIds.slice(0, 1) : nextIds)
    }
  }, [job])

  const groupOptions = groups.map((group) => ({ value: group.id, label: group.name }))
  const storeOptions = stores.map((store) => ({ value: store.id, label: store.name }))
  const fiscalYearOptions = fiscalYears.map((year) => ({ value: year.id, label: year.name }))

  const filteredConnections = connections.filter((connection) => {
    if (filterGroup != null && connection.group_id !== filterGroup) return false
    if (filterStore != null && connection.store_id !== filterStore) return false
    if (filterFiscalYear != null && connection.fiscal_year_id !== filterFiscalYear) return false
    return true
  })

  const selectedConnections = connections.filter((connection) =>
    selectedConnectionIds.includes(connection.id)
  )
  const filteredConnectionIds = new Set(filteredConnections.map((connection) => connection.id))
  const selectableConnections = filteredConnections.concat(
    selectedConnections.filter((connection) => !filteredConnectionIds.has(connection.id))
  )

  const connectionOptions = selectableConnections.map((connection) => ({
    value: connection.id,
    label: connection.name
  }))

  if (!job) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Job Not Found</CardTitle>
            <CardDescription>
              This job is not visible to your account or the link is invalid.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate('/jobs')}>
              <ArrowLeft className="size-4 mr-2" />
              Back to Jobs
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const hasChanges =
    JSON.stringify(selectedConnectionIds) !== JSON.stringify(normalizedJobConnectionIds)

  async function handleSave(): Promise<void> {
    if (!job) {
      return
    }

    setIsSaving(true)
    try {
      const nextIds = normalizeNumberArray(selectedConnectionIds)
      await updateConnections(job.id, isMultiQueryJob ? nextIds.slice(0, 1) : nextIds)
      navigate('/jobs')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Link2 className="size-4" />
              Job Connections
            </div>
            <CardTitle className="text-xl">{job.name}</CardTitle>
            <CardDescription>
              Update only the connections for this job. Full job editing remains restricted.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/jobs')}>
              <ArrowLeft className="size-4 mr-2" />
              Back
            </Button>
            <Button onClick={() => void handleSave()} disabled={isSaving || !hasChanges}>
              <Save className="size-4 mr-2" />
              Save Connections
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Job type: <strong className="text-foreground">{job.type}</strong>
            </span>
            <span>•</span>
            <span>
              Selected: <strong className="text-foreground">{selectedConnectionIds.length}</strong>
            </span>
            {isMultiQueryJob && (
              <>
                <span>•</span>
                <span>Multi-query jobs allow only one connection at a time.</span>
              </>
            )}
            {!isAdmin && (
              <>
                <span>•</span>
                <span>You can choose only connections visible to your account.</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectBox
              options={groupOptions}
              value={filterGroup ?? undefined}
              onChange={(value) => setFilterGroup(normalizeNumber(value))}
              placeholder="Filter by group…"
              clearable
              searchable
            />
            <SelectBox
              options={storeOptions}
              value={filterStore ?? undefined}
              onChange={(value) => setFilterStore(normalizeNumber(value))}
              placeholder="Filter by store…"
              clearable
              searchable
            />
            <SelectBox
              options={fiscalYearOptions}
              value={filterFiscalYear ?? undefined}
              onChange={(value) => setFilterFiscalYear(normalizeNumber(value))}
              placeholder="Filter by fiscal year…"
              clearable
              searchable
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Available Connections</p>
            {isMultiQueryJob ? (
              <SelectBox
                options={connectionOptions}
                value={selectedConnectionIds[0] ?? undefined}
                onChange={(value) => {
                  const ids = value != null ? normalizeNumberArray([value]) : []
                  setSelectedConnectionIds(ids.slice(0, 1))
                }}
                placeholder={
                  filteredConnections.length === 0
                    ? 'No connections match the current filters'
                    : `Select one of ${filteredConnections.length} connection(s)…`
                }
                searchable
                clearable
              />
            ) : (
              <SelectBox
                multiple
                options={connectionOptions}
                value={selectedConnectionIds}
                onChange={(values) => {
                  const ids = Array.isArray(values)
                    ? normalizeNumberArray(values)
                    : values != null
                      ? normalizeNumberArray([values])
                      : []
                  setSelectedConnectionIds(ids)
                }}
                placeholder={
                  filteredConnections.length === 0
                    ? 'No connections match the current filters'
                    : `Select from ${filteredConnections.length} connection(s)…`
                }
                searchable
                clearable
                showSelectAll
              />
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Selected Connections</p>
            {selectedConnections.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedConnections.map((connection) => (
                  <Badge key={connection.id} variant="outline">
                    {connection.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No connections selected.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
