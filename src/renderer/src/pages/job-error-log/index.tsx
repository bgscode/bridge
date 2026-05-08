import { JSX, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  SearchX,
  Server,
  XCircle
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useJobs } from '@/contexts'
import { formatUtcToIst } from '@/lib/utils'
import type { JobRow } from '@shared/index'

// ─── Per-connection error list ─────────────────────────────────────────────────

function ConnectionErrorList({
  errors
}: {
  errors: { id: number; name: string; error: string }[]
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {errors.map((ce) => (
        <div
          key={ce.id}
          className="rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-1"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Server className="size-3.5 shrink-0" />
            <span>
              {ce.name}
              <span className="ml-2 font-normal text-amber-600/70 dark:text-amber-400/70">
                ID: {ce.id}
              </span>
            </span>
          </div>
          <pre className="text-xs bg-amber-100 dark:bg-black/60 text-amber-900 dark:text-amber-200 rounded px-3 py-2 whitespace-pre-wrap break-all font-mono overflow-auto max-h-40">
            {ce.error}
          </pre>
        </div>
      ))}
    </div>
  )
}

// ─── Error Detail Row ─────────────────────────────────────────────────────────

function ErrorDetailRow({ job }: { job: JobRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const connectionErrors = job.last_connection_errors ?? []
  const hasConnErrors = connectionErrors.length > 0

  const errorLines = (job.last_error ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-destructive/10 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm truncate">{job.name}</span>
            <Badge variant="destructive" className="text-xs">
              failed
            </Badge>
            {hasConnErrors && (
              <Badge variant="outline" className="text-xs border-orange-400/50 text-orange-400">
                <XCircle className="size-3 mr-1" />
                {connectionErrors.length} connection{connectionErrors.length !== 1 ? 's' : ''}{' '}
                failed
              </Badge>
            )}
          </div>
          {!expanded && errorLines[0] && (
            <p className="text-xs text-destructive/80 mt-1 truncate max-w-2xl">{errorLines[0]}</p>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="size-3" />
          {job.last_run_at ? formatUtcToIst(job.last_run_at) : '—'}
        </div>

        <span className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <Separator className="bg-destructive/20" />

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Job-Level Error
            </p>
            <pre className="text-xs bg-black/80 text-red-400 rounded-md p-3 whitespace-pre-wrap break-all font-mono overflow-auto max-h-40">
              {job.last_error || 'No error message recorded.'}
            </pre>
          </div>

          {hasConnErrors && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Connection-Wise Errors ({connectionErrors.length})
              </p>
              <ConnectionErrorList errors={connectionErrors} />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <InfoCell label="Job Type" value={job.type} />
            <InfoCell
              label="Last Run"
              value={job.last_run_at ? formatUtcToIst(job.last_run_at) : '—'}
            />
            <InfoCell
              label="Failed Connections"
              value={
                job.last_failed_connection_ids.length > 0
                  ? `${job.last_failed_connection_ids.length} failed`
                  : 'None recorded'
              }
            />
            <InfoCell label="Online Only" value={job.online_only ? 'Yes' : 'No'} />
            <InfoCell label="Multi Query" value={job.is_multi ? 'Yes' : 'No'} />
            <InfoCell label="Destination" value={job.destination_type ?? 'Action job'} />
          </div>
        </div>
      )}
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobErrorLogPage(): JSX.Element {
  const { jobs, reload } = useJobs()
  const [search, setSearch] = useState('')

  const failedJobs = jobs
    .filter((j) => j.status === 'failed')
    .filter(
      (j) =>
        search.trim() === '' ||
        j.name.toLowerCase().includes(search.toLowerCase()) ||
        (j.last_error ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (j.last_connection_errors ?? []).some(
          (ce) =>
            ce.name.toLowerCase().includes(search.toLowerCase()) ||
            ce.error.toLowerCase().includes(search.toLowerCase())
        )
    )
    .sort((a, b) => {
      if (!a.last_run_at) return 1
      if (!b.last_run_at) return -1
      return new Date(b.last_run_at).getTime() - new Date(a.last_run_at).getTime()
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-4 text-destructive" />
              Job Error Log
            </CardTitle>
            <CardDescription className="text-sm">
              Detailed view of all failed jobs — see exactly why each job &amp; each connection
              failed.
            </CardDescription>
          </div>

          <Button size="sm" variant="outline" className="shrink-0 gap-2" onClick={() => reload()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </CardHeader>

        <Separator />

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 bg-destructive/10 border-destructive/30">
              <AlertTriangle className="size-3.5 text-destructive" />
              <span className="font-medium text-destructive">
                {jobs.filter((j) => j.status === 'failed').length} Failed
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <CheckCircle2 className="size-3.5 text-green-500" />
              <span className="font-medium">
                {jobs.filter((j) => j.status === 'success').length} Succeeded
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="text-muted-foreground">Total jobs: {jobs.length}</span>
            </div>
            <div className="ml-auto">
              <Input
                placeholder="Search by job name, connection or error…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-72 text-sm"
              />
            </div>
          </div>

          {failedJobs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground py-16">
              <SearchX className="size-10 opacity-40" />
              <p className="text-sm font-medium">
                {search
                  ? 'No matching failed jobs found.'
                  : 'No failed jobs — everything looks good!'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {failedJobs.map((job) => (
                <ErrorDetailRow key={job.id} job={job} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
