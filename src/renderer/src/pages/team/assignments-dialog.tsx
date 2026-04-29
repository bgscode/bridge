import { useEffect, useMemo, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { assignmentsApi, type AuthUser } from '@/lib/api'
import {
  useConnections,
  useFiscalYears,
  useGroups,
  useJobGroups,
  useJobs,
  useStores
} from '@/contexts'

interface Props {
  user: AuthUser | null
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function AssignmentsDialog({ user, open, onOpenChange }: Props): JSX.Element {
  const { connections } = useConnections()
  const { jobs } = useJobs()
  const { groups } = useGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const { jobGroups } = useJobGroups()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connIds, setConnIds] = useState<Set<string>>(new Set())
  const [jobIds, setJobIds] = useState<Set<string>>(new Set())
  const [connSearch, setConnSearch] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [connGroupFilter, setConnGroupFilter] = useState('all')
  const [connStoreFilter, setConnStoreFilter] = useState('all')
  const [connFyFilter, setConnFyFilter] = useState('all')
  const [jobGroupFilter, setJobGroupFilter] = useState('all')

  useEffect(() => {
    if (!open || !user) return
    let cancelled = false
    setLoading(true)
    assignmentsApi
      .get(user.id)
      .then((d) => {
        if (cancelled) return
        setConnIds(new Set(d.connectionIds))
        setJobIds(new Set(d.jobIds))
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, user])

  useEffect(() => {
    if (!open) return
    setConnSearch('')
    setJobSearch('')
    setConnGroupFilter('all')
    setConnStoreFilter('all')
    setConnFyFilter('all')
    setJobGroupFilter('all')
  }, [open])

  async function save(): Promise<void> {
    if (!user) return
    setSaving(true)
    try {
      await Promise.all([
        assignmentsApi.setConnections(user.id, Array.from(connIds)),
        assignmentsApi.setJobs(user.id, Array.from(jobIds))
      ])
      toast.success(`Assignments updated for ${user.name}`)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Only rows that have a server UUID can be assigned.
  const conns = connections.filter((c) => !!c.remote_id)
  const js = jobs.filter((j) => !!j.remote_id)

  const filteredConns = useMemo(() => {
    const q = connSearch.trim().toLowerCase()
    return conns.filter((c) => {
      if (connGroupFilter !== 'all' && String(c.group_id ?? '') !== connGroupFilter) return false
      if (connStoreFilter !== 'all' && String(c.store_id ?? '') !== connStoreFilter) return false
      if (connFyFilter !== 'all' && String(c.fiscal_year_id ?? '') !== connFyFilter) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [conns, connSearch, connGroupFilter, connStoreFilter, connFyFilter])

  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase()
    return js.filter((j) => {
      if (jobGroupFilter !== 'all' && String(j.job_group_id ?? '') !== jobGroupFilter) return false
      if (q && !j.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [js, jobSearch, jobGroupFilter])

  const selectedVisibleConns = filteredConns.reduce(
    (n, c) => n + (connIds.has(c.remote_id as string) ? 1 : 0),
    0
  )
  const selectedVisibleJobs = filteredJobs.reduce(
    (n, j) => n + (jobIds.has(j.remote_id as string) ? 1 : 0),
    0
  )

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string): void => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-full sm:max-w-4xl flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Assign to {user?.name ?? ''}</DialogTitle>
          <DialogDescription>
            Pick which connections and jobs this user can access.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 flex-1 min-h-0">
            {/* Connections */}
            <div className="flex flex-col min-h-0 border-r">
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-2">
                <span>
                  Connections ({filteredConns.length}/{conns.length}) · {connIds.size} selected
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      const visibleIds = filteredConns.map((c) => c.remote_id as string)
                      const next = new Set(connIds)
                      if (
                        selectedVisibleConns === filteredConns.length &&
                        filteredConns.length > 0
                      ) {
                        visibleIds.forEach((id) => next.delete(id))
                      } else {
                        visibleIds.forEach((id) => next.add(id))
                      }
                      setConnIds(next)
                    }}
                  >
                    {selectedVisibleConns === filteredConns.length && filteredConns.length > 0
                      ? 'Clear visible'
                      : 'Select visible'}
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      if (connIds.size === conns.length && conns.length > 0) {
                        setConnIds(new Set())
                      } else {
                        setConnIds(new Set(conns.map((c) => c.remote_id as string)))
                      }
                    }}
                  >
                    {connIds.size === conns.length && conns.length > 0 ? 'Clear all' : 'Select all'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 px-4 pb-2 md:grid-cols-2">
                <Input
                  value={connSearch}
                  onChange={(e) => setConnSearch(e.target.value)}
                  placeholder="Search connection"
                  className="md:col-span-2"
                />
                <Select value={connStoreFilter} onValueChange={setConnStoreFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All stores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stores</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={connFyFilter} onValueChange={setConnFyFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All fiscal years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All fiscal years</SelectItem>
                    {fiscalYears.map((fy) => (
                      <SelectItem key={fy.id} value={String(fy.id)}>
                        {fy.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={connGroupFilter} onValueChange={setConnGroupFilter}>
                  <SelectTrigger className="w-full md:col-span-2">
                    <SelectValue placeholder="All groups" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All groups</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="flex-1 max-h-[50vh] px-4 pb-4">
                {filteredConns.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No connections synced yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {filteredConns.map((c) => {
                      const rid = c.remote_id as string
                      const checked = connIds.has(rid)
                      return (
                        <li key={rid}>
                          <label className="flex items-center gap-2 py-1 cursor-pointer">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggle(connIds, setConnIds, rid)}
                            />
                            <span className="text-sm truncate">{c.name}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </ScrollArea>
            </div>

            {/* Jobs */}
            <div className="flex flex-col min-h-0">
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-2">
                <span>
                  Jobs ({filteredJobs.length}/{js.length}) · {jobIds.size} selected
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      const visibleIds = filteredJobs.map((j) => j.remote_id as string)
                      const next = new Set(jobIds)
                      if (selectedVisibleJobs === filteredJobs.length && filteredJobs.length > 0) {
                        visibleIds.forEach((id) => next.delete(id))
                      } else {
                        visibleIds.forEach((id) => next.add(id))
                      }
                      setJobIds(next)
                    }}
                  >
                    {selectedVisibleJobs === filteredJobs.length && filteredJobs.length > 0
                      ? 'Clear visible'
                      : 'Select visible'}
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      if (jobIds.size === js.length && js.length > 0) {
                        setJobIds(new Set())
                      } else {
                        setJobIds(new Set(js.map((j) => j.remote_id as string)))
                      }
                    }}
                  >
                    {jobIds.size === js.length && js.length > 0 ? 'Clear all' : 'Select all'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 px-4 pb-2">
                <Input
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder="Search job"
                />
                <Select value={jobGroupFilter} onValueChange={setJobGroupFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All job groups" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All job groups</SelectItem>
                    {jobGroups.map((jg) => (
                      <SelectItem key={jg.id} value={String(jg.id)}>
                        {jg.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="flex-1 max-h-[50vh] px-4 pb-4">
                {filteredJobs.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No jobs synced yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {filteredJobs.map((j) => {
                      const rid = j.remote_id as string
                      const checked = jobIds.has(rid)
                      return (
                        <li key={rid}>
                          <label className="flex items-center gap-2 py-1 cursor-pointer">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggle(jobIds, setJobIds, rid)}
                            />
                            <span className="text-sm truncate">{j.name}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </ScrollArea>
            </div>
          </div>
        )}

        <Separator />
        <DialogFooter className="mx-0! mb-0! rounded-none bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2Icon className="size-4 animate-spin mr-2" />}
            Save assignments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
