import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  GripHorizontal,
  Loader2,
  RotateCcw,
  Server,
  Square,
  X,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useJobs } from '@/contexts'
import type { JobProgress, JobConnectionProgress, JobAdaptiveState } from '@shared/index'

// ─── Adaptive engine row ─────────────────────────────────────────────────────

function AdaptiveRow({
  adaptive,
  isRunning
}: {
  adaptive: JobAdaptiveState
  isRunning: boolean
}): JSX.Element {
  const healthPct = Math.round(adaptive.health_score * 100)
  const healthColor =
    adaptive.health_score >= 0.75
      ? 'bg-emerald-500'
      : adaptive.health_score >= 0.4
        ? 'bg-amber-500'
        : 'bg-destructive'

  const fmtLabel = adaptive.output_format
    ? adaptive.output_format === 'excel-stream'
      ? 'XLSX (stream)'
      : adaptive.output_format.toUpperCase()
    : null

  return (
    <div className="px-3 pb-2 space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <div
          className="flex items-center gap-1"
          title={`CPU ${(adaptive.cpu * 100).toFixed(0)}%, Mem ${(adaptive.memory * 100).toFixed(0)}%, Lag ${adaptive.lag_ms.toFixed(0)}ms`}
        >
          <span className={cn('size-1.5 rounded-full', healthColor)} />
          <span>health {healthPct}%</span>
        </div>
        {isRunning && (
          <span title="Active workers / target workers">
            workers {adaptive.active_workers}/{adaptive.target_workers}
          </span>
        )}
        {adaptive.throughput > 0 && (
          <span>{Math.round(adaptive.throughput).toLocaleString()} rows/s</span>
        )}
        {fmtLabel && (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[9px] font-normal ml-auto"
            title={adaptive.output_reason ?? ''}
          >
            {fmtLabel}
          </Badge>
        )}
      </div>
      {adaptive.backpressure && isRunning && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 truncate">
          ⚠ backpressure — {adaptive.reason}
        </p>
      )}
    </div>
  )
}

// ─── Connection status icon ──────────────────────────────────────────────────

function ConnStatusIcon({ status }: { status: JobConnectionProgress['status'] }): JSX.Element {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="size-3.5 text-emerald-500" />
    case 'error':
      return <XCircle className="size-3.5 text-destructive" />
    case 'connecting':
    case 'querying':
      return <Loader2 className="size-3.5 animate-spin text-blue-500" />
    default:
      return <Server className="size-3.5 text-muted-foreground" />
  }
}

function connStatusLabel(status: JobConnectionProgress['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting'
    case 'connecting':
      return 'Connecting…'
    case 'querying':
      return 'Querying…'
    case 'done':
      return 'Done'
    case 'error':
      return 'Failed'
  }
}

// ─── Single job card ─────────────────────────────────────────────────────────

function JobCard({
  progress,
  onDismiss
}: {
  progress: JobProgress
  onDismiss: () => void
}): JSX.Element {
  const { cancel, jobs, run } = useJobs()
  const [expanded, setExpanded] = useState(false)
  const [combining, setCombining] = useState(false)
  const [combinedPath, setCombinedPath] = useState<string | null>(null)
  const autoCombinedRef = useRef(false)

  const isRunning = progress.status === 'running'
  const isSuccess = progress.status === 'success'
  const isFailed = progress.status === 'failed' || progress.status === 'cancelled'

  // IDs of connections that errored on the latest run — used to power the
  // "Retry failed connections" button. Computed off the live progress so the
  // button matches what the user is currently seeing in the expanded list.
  const failedConnectionIds = useMemo(
    () => progress.connections.filter((c) => c.status === 'error').map((c) => c.connection_id),
    [progress.connections]
  )

  const retryFailed = useCallback((): void => {
    if (failedConnectionIds.length === 0) return
    run(progress.job_id, { connection_ids: failedConnectionIds })
  }, [failedConnectionIds, progress.job_id, run])

  const pct =
    progress.total_connections > 0
      ? Math.round((progress.completed_connections / progress.total_connections) * 100)
      : 0

  const elapsed = progress.started_at
    ? Math.round(
        ((progress.finished_at ? new Date(progress.finished_at).getTime() : Date.now()) -
          new Date(progress.started_at).getTime()) /
          1000
      )
    : 0
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`

  // Output is a CSV folder when adaptive engine chose CSV and output_path is a dir-like path.
  const isCsvFolderOutput =
    isSuccess &&
    progress.output_path != null &&
    !/\.(xlsx|xls)$/i.test(progress.output_path) &&
    progress.adaptive?.output_format === 'csv'

  const runCombine = useCallback(async (): Promise<void> => {
    if (!progress.output_path) return
    setCombining(true)
    try {
      const job = jobs.find((j) => j.id === progress.job_id) ?? null
      // The destination itself IS the template when it points to an .xlsx file.
      // Combiner will rewrite into that file in-place (existing mode) rather
      // than creating a new workbook alongside the CSV folder.
      const dest = (job?.destination_config ?? '').trim()
      const destIsXlsx = dest.toLowerCase().endsWith('.xlsx')
      const result = await window.api.combiner.combine({
        folder: progress.output_path,
        template_path: destIsXlsx ? dest : null,
        template_mode: destIsXlsx ? 'existing' : null,
        operation: job?.operation ?? 'replace'
      })
      const out = result.output_paths[0] ?? null
      setCombinedPath(out)
      toast.success(
        `Combined ${result.sheet_count} sheet(s), ${result.total_rows.toLocaleString()} row(s)`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to combine CSV folder'
      toast.error(msg)
    } finally {
      setCombining(false)
    }
  }, [jobs, progress.job_id, progress.output_path])

  // Auto-trigger combine once, when a CSV-output job completes successfully.
  useEffect(() => {
    if (!isCsvFolderOutput) return
    if (autoCombinedRef.current) return
    if (combinedPath || combining) return
    autoCombinedRef.current = true
    void runCombine()
  }, [isCsvFolderOutput, combinedPath, combining, runCombine])

  // Auto-dismiss the card 5 s after the job is fully done.
  // For CSV-folder outputs we wait until combine has finished (success or
  // failure) before starting the timer so the user can see the final state.
  useEffect(() => {
    const isTerminal = isSuccess || isFailed
    if (!isTerminal) return
    if (combining) return
    if (isCsvFolderOutput && !combinedPath) return
    const t = setTimeout(() => onDismiss(), 10000)
    return () => clearTimeout(t)
  }, [isSuccess, isFailed, isCsvFolderOutput, combining, combinedPath, onDismiss])

  // Status icon
  const StatusIcon = isSuccess ? (
    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
  ) : isFailed ? (
    <XCircle className="size-4 text-destructive shrink-0" />
  ) : (
    <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
  )

  return (
    <div
      className={cn(
        'rounded-lg border bg-card shadow-lg',
        isSuccess && 'border-emerald-500/40',
        isFailed && 'border-destructive/40'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {StatusIcon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{progress.job_name}</p>
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <p className="flex items-center gap-1.5">
              <span>
                {progress.completed_connections}/{progress.total_connections} connections
              </span>
              {progress.failed_connections > 0 && (
                <Badge variant="destructive" className="h-4 px-1.5 text-[9px] font-normal">
                  {progress.failed_connections} failed
                </Badge>
              )}
            </p>
            <p className="flex items-center gap-1.5">
              <span>{elapsedStr}</span>
              {progress.total_rows > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-normal">
                  {progress.total_rows.toLocaleString()} rows
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </Button>
          {isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-destructive hover:text-destructive"
              title="Cancel job"
              onClick={() => cancel(progress.job_id)}
            >
              <Square className="size-3" />
            </Button>
          )}
          {!isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Dismiss"
              onClick={onDismiss}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 pb-2">
        <Progress
          value={pct}
          className={cn(
            'h-1.5',
            isSuccess && '*:data-[slot=progress-indicator]:bg-emerald-500',
            isFailed && '*:data-[slot=progress-indicator]:bg-destructive'
          )}
        />
      </div>

      {/* Adaptive engine indicator */}
      {progress.adaptive && (isRunning || progress.adaptive.output_format) && (
        <AdaptiveRow adaptive={progress.adaptive} isRunning={isRunning} />
      )}

      {/* Output actions — show when file was written */}
      {progress.output_path && (isSuccess || isFailed) && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {/*
            Single "Open File" button:
              - When a combined Excel exists, the CSV folder has already been
                deleted by the combiner, so there is nothing useful to "show"
                separately — just open the rewritten workbook.
              - Otherwise point at whatever the job produced (xlsx / folder).
          */}
          {!combining && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => window.api.shell.openPath(combinedPath ?? progress.output_path!)}
            >
              {combinedPath ? (
                <FileSpreadsheet className="size-3" />
              ) : (
                <ExternalLink className="size-3" />
              )}
              Open File
            </Button>
          )}
          {isCsvFolderOutput && combining && (
            <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" disabled>
              <Loader2 className="size-3 animate-spin" />
              Combining…
            </Button>
          )}
          {failedConnectionIds.length > 0 && !combining && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={retryFailed}
              title={`Re-run only the ${failedConnectionIds.length} failed connection(s)`}
            >
              <RotateCcw className="size-3" />
              Retry {failedConnectionIds.length} failed
            </Button>
          )}
        </div>
      )}

      {/*
        When there is NO output_path (e.g. a job failed before writing anything)
        we still want the user to be able to retry just the failed connections.
      */}
      {!progress.output_path && isFailed && failedConnectionIds.length > 0 && (
        <div className="px-3 pb-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 w-full"
            onClick={retryFailed}
          >
            <RotateCcw className="size-3" />
            Retry {failedConnectionIds.length} failed connection
            {failedConnectionIds.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Expanded connection details */}
      {expanded && (
        <>
          <Separator />
          <div className="max-h-64 overflow-y-auto overflow-x-hidden">
            <div className="px-3 py-2 space-y-1.5 pr-1">
              {progress.connections.map((c) => (
                <div key={c.connection_id} className="flex items-center gap-2 text-xs pr-3">
                  <ConnStatusIcon status={c.status} />
                  <span className="flex-1 truncate min-w-0">{c.connection_name}</span>
                  <span
                    className={cn(
                      'shrink-0 whitespace-nowrap',
                      c.status === 'done' && 'text-emerald-500',
                      c.status === 'error' && 'text-destructive',
                      (c.status === 'connecting' || c.status === 'querying') && 'text-blue-500',
                      c.status === 'pending' && 'text-muted-foreground'
                    )}
                  >
                    {connStatusLabel(c.status)}
                  </span>
                  {c.rows > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0">
                      {c.rows} rows
                    </Badge>
                  )}
                  {c.status === 'error' && !isRunning && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                      title={`Retry "${c.connection_name}"`}
                      onClick={() => run(progress.job_id, { connection_ids: [c.connection_id] })}
                    >
                      <RotateCcw className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {progress.failed_connections > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[11px] text-destructive">
                {progress.failed_connections} connection(s) failed
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Drag hook ───────────────────────────────────────────────────────────────

function useDraggable(
  initialPos: { x: number; y: number },
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [pos, setPos] = useState(initialPos)
  const dragging = useRef(false)
  const offset = useRef({ x: 0, y: 0 })
  const MARGIN = 8
  const HEADER_HEIGHT = 48

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true
      offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [pos]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return

      const panel = containerRef.current
      const panelWidth = panel?.offsetWidth ?? 320
      const panelHeight = panel?.offsetHeight ?? 120

      const maxX = Math.max(MARGIN, window.innerWidth - panelWidth - MARGIN)
      const minY = HEADER_HEIGHT + MARGIN
      const maxY = Math.max(minY, window.innerHeight - panelHeight - MARGIN)

      setPos({
        x: Math.max(MARGIN, Math.min(maxX, e.clientX - offset.current.x)),
        y: Math.max(minY, Math.min(maxY, e.clientY - offset.current.y))
      })
    },
    [containerRef]
  )

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  return { pos, handlers: { onPointerDown, onPointerMove, onPointerUp } }
}

// ─── Floating indicator ──────────────────────────────────────────────────────

export function FloatingJobProgress(): JSX.Element | null {
  const { runningJobs, dismissJob } = useJobs()
  const [minimized, setMinimized] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { pos, handlers } = useDraggable(
    {
      x: window.innerWidth - 340,
      y: window.innerHeight - 200
    },
    panelRef
  )

  // Recalculate initial position on window resize
  useEffect(() => {
    const onResize = (): void => {
      // no-op: keep current pos, user may have dragged
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (runningJobs.length === 0) return null

  const allDone = runningJobs.every(
    (j) => j.status === 'success' || j.status === 'failed' || j.status === 'cancelled'
  )

  return (
    <div ref={panelRef} className="fixed z-40 w-80" style={{ left: pos.x, top: pos.y }}>
      {/* Minimized pill */}
      {minimized ? (
        <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing" {...handlers}>
          <Button
            variant="default"
            size="sm"
            className="gap-2 shadow-lg"
            onClick={() => setMinimized(false)}
          >
            {allDone ? (
              <CheckCircle2 className="size-3.5 text-emerald-400" />
            ) : (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {runningJobs.length} job(s){allDone ? ' done' : ''}
            <ChevronUp className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2 max-h-[70vh] overflow-y-auto overflow-x-hidden pr-1">
          {/* Header — full row is drag handle */}
          <div
            className="flex items-center justify-between rounded-lg border bg-card px-3 py-1.5 shadow-sm cursor-grab active:cursor-grabbing select-none"
            {...handlers}
          >
            <div className="flex items-center gap-1.5">
              <GripHorizontal className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Jobs ({runningJobs.length})
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={(e) => {
                e.stopPropagation()
                setMinimized(true)
              }}
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>

          {/* Job cards */}
          {runningJobs.map((progress) => (
            <JobCard
              key={progress.job_id}
              progress={progress}
              onDismiss={() => dismissJob(progress.job_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
