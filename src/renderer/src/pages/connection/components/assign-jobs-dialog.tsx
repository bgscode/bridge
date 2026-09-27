import { JSX, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useJobGroups, useJobs } from '@/contexts'
import type { ConnectionRow } from '@shared/index'

interface Props {
  connection: ConnectionRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function jobHasConnection(connectionIds: number[] | null | undefined, connectionId: number): boolean {
  return Array.isArray(connectionIds) && connectionIds.includes(connectionId)
}

export function AssignJobsDialog({ connection, open, onOpenChange }: Props): JSX.Element {
  const { jobs, reload } = useJobs()
  const { jobGroups } = useJobGroups()
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [saving, setSaving] = useState(false)

  const connectionId = connection?.id ?? null

  useEffect(() => {
    if (!open || connectionId == null) return
    setSearch('')
    setGroupFilter('all')
    setSelectedJobIds(
      new Set(
        jobs.filter((job) => jobHasConnection(job.connection_ids, connectionId)).map((job) => job.id)
      )
    )
    // Seed once per open. Later job reloads must not wipe the user's checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId])

  const groupName = useMemo(() => {
    const map = new Map<number, string>()
    for (const group of jobGroups) map.set(group.id, group.name)
    return map
  }, [jobGroups])

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return jobs.filter((job) => {
      if (groupFilter !== 'all' && String(job.job_group_id ?? '') !== groupFilter) return false
      if (!query) return true
      return job.name.toLowerCase().includes(query)
    })
  }, [jobs, search, groupFilter])

  function isBlocked(jobId: number): boolean {
    if (!connection) return true
    const job = jobs.find((entry) => entry.id === jobId)
    if (!job?.is_multi) return false
    const ids = Array.isArray(job.connection_ids) ? job.connection_ids : []
    return ids.length > 0 && !ids.includes(connection.id)
  }

  function toggle(jobId: number): void {
    if (isBlocked(jobId)) return
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  function setVisible(checked: boolean): void {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      for (const job of filteredJobs) {
        if (isBlocked(job.id)) continue
        if (checked) next.add(job.id)
        else next.delete(job.id)
      }
      return next
    })
  }

  const selectableVisible = filteredJobs.filter((job) => !isBlocked(job.id))
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((job) => selectedJobIds.has(job.id))

  async function save(): Promise<void> {
    if (!connection) return
    const changes = jobs.filter((job) => {
      const has = jobHasConnection(job.connection_ids, connection.id)
      return has !== selectedJobIds.has(job.id)
    })
    if (changes.length === 0) {
      onOpenChange(false)
      return
    }

    setSaving(true)
    let added = 0
    let removed = 0
    try {
      for (const job of changes) {
        const ids = new Set(Array.isArray(job.connection_ids) ? job.connection_ids : [])
        if (selectedJobIds.has(job.id)) {
          if (job.is_multi && ids.size > 0 && !ids.has(connection.id)) continue
          ids.add(connection.id)
          added += 1
        } else {
          ids.delete(connection.id)
          removed += 1
        }
        await window.api.jobs.updateConnections(job.id, Array.from(ids))
      }
      reload()
      const parts = [
        added > 0 ? `added to ${added} job${added === 1 ? '' : 's'}` : '',
        removed > 0 ? `removed from ${removed} job${removed === 1 ? '' : 's'}` : ''
      ].filter(Boolean)
      toast.success(`${connection.name} ${parts.join(' and ')}.`)
      onOpenChange(false)
    } catch (error) {
      reload()
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,720px)] w-full min-w-0 flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>Assign to jobs</DialogTitle>
          <DialogDescription>
            Add{' '}
            <span className="font-medium text-foreground">{connection?.name ?? 'this connection'}</span>{' '}
            to many jobs at once. Jobs that already use it stay checked.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 gap-2">
            <Input
              className="min-w-0 flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs…"
            />
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="w-[9.5rem] shrink-0">
                <SelectValue placeholder="Job group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {jobGroups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(value) => setVisible(value === true)}
              disabled={selectableVisible.length === 0 || saving}
            />
            Select visible jobs ({selectableVisible.length})
          </label>

          <div className="h-72 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto rounded-md border">
            <div className="flex min-w-0 flex-col p-2">
              {filteredJobs.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">No jobs match.</p>
              ) : (
                filteredJobs.map((job) => {
                  const blocked = isBlocked(job.id)
                  const checked = selectedJobIds.has(job.id)
                  const group = job.job_group_id != null ? groupName.get(job.job_group_id) : null
                  return (
                    <label
                      key={job.id}
                      className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-sm ${
                        blocked ? 'opacity-60' : 'hover:bg-muted'
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5 shrink-0"
                        checked={checked}
                        disabled={blocked || saving}
                        onCheckedChange={() => toggle(job.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{job.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {group ?? 'No group'}
                          {job.is_multi ? ' · one connection only' : ''}
                          {blocked ? ' · already using another connection' : ''}
                        </span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !connection}>
            {saving ? 'Saving…' : `Save (${selectedJobIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
