import { JSX, useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Clock, Play, RefreshCw, Timer, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useJobs } from '@/contexts'
import type { JobRow } from '@shared/index'

// ─── Schedule Config ──────────────────────────────────────────────────────────

interface ScheduleConfig {
  type: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
  time?: string
  days?: number[]
  date?: string
  intervalValue?: number
  intervalUnit?: 'minutes' | 'hours'
  cron?: string
  repeatCount?: number
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseScheduleConfig(raw: string | null): ScheduleConfig | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ScheduleConfig
  } catch {
    return null
  }
}

function describeSchedule(cfg: ScheduleConfig): string {
  switch (cfg.type) {
    case 'once':
      return `Once on ${cfg.date ?? '—'} at ${cfg.time ?? '08:00'}`
    case 'daily':
      return `Daily at ${cfg.time ?? '08:00'}`
    case 'weekly': {
      const days = (cfg.days ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map((d) => DAY_NAMES[d])
        .join(', ')
      return `Weekly · ${days || '—'} at ${cfg.time ?? '08:00'}`
    }
    case 'monthly':
      return `Monthly · day ${cfg.date ?? '1'} at ${cfg.time ?? '08:00'}`
    case 'interval':
      return `Every ${cfg.intervalValue ?? 30} ${cfg.intervalUnit ?? 'minutes'}`
    case 'cron':
      return `Cron: ${cfg.cron ?? '—'}`
    default:
      return 'Scheduled'
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SchedulerEntry {
  jobId: number
  nextRunAt: string | null
  runCount: number
}

interface ScheduleEvent {
  job: JobRow
  nextRunAt: Date
  runCount: number
  schedule: ScheduleConfig
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(date: Date): string {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage(): JSX.Element {
  const { jobs } = useJobs()
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerEntry[]>([])
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)

  // Live countdown tick
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const status = await window.api.jobs.schedulerStatus()
      setSchedulerStatus(status as SchedulerEntry[])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
    const timer = setInterval(() => void fetchStatus(), 30_000)
    return () => clearInterval(timer)
  }, [fetchStatus])

  // Merge jobs + scheduler status into events
  const events = useMemo((): ScheduleEvent[] => {
    const statusMap = new Map(schedulerStatus.map((s) => [s.jobId, s]))
    const result: ScheduleEvent[] = []
    for (const job of jobs) {
      if (!job.schedule) continue
      const cfg = parseScheduleConfig(job.schedule)
      if (!cfg) continue
      const entry = statusMap.get(job.id)
      if (!entry?.nextRunAt) continue
      const nextRunAt = new Date(entry.nextRunAt)
      if (isNaN(nextRunAt.getTime())) continue
      result.push({ job, nextRunAt, runCount: entry.runCount, schedule: cfg })
    }
    return result.sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())
  }, [jobs, schedulerStatus])

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    for (const ev of events) {
      const key = ev.nextRunAt.toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ev)
    }
    return Array.from(map.entries()).map(([key, evs]) => ({
      date: new Date(key),
      events: evs
    }))
  }, [events])

  // Jobs with schedule but no upcoming nextRunAt (e.g. once-completed)
  const noNextRunJobs = useMemo(() => {
    const statusMap = new Map(schedulerStatus.map((s) => [s.jobId, s]))
    return jobs.filter((job) => {
      if (!job.schedule) return false
      const cfg = parseScheduleConfig(job.schedule)
      if (!cfg) return false
      const entry = statusMap.get(job.id)
      return !entry?.nextRunAt
    })
  }, [jobs, schedulerStatus])

  const nextEvent = events[0] ?? null
  const todayStr = new Date().toDateString()
  const todayCount = grouped.find((g) => g.date.toDateString() === todayStr)?.events.length ?? 0
  const scheduledCount = jobs.filter((j) => !!j.schedule).length

  return (
    <div className="flex flex-col gap-6 p-6 flex-1 min-h-0 overflow-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Job Schedule</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upcoming scheduled job runs across all jobs
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchStatus()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <CalendarClock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{scheduledCount}</p>
                <p className="text-xs text-muted-foreground">Scheduled Jobs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-orange-500/10 p-2 shrink-0">
                <Clock className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{todayCount}</p>
                <p className="text-xs text-muted-foreground">Runs Today</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-green-500/10 p-2 shrink-0">
                <Timer className="h-4 w-4 text-green-500" />
              </div>
              <div className="min-w-0">
                {nextEvent ? (
                  <>
                    <p className="text-2xl font-bold tabular-nums">
                      {formatCountdown(nextEvent.nextRunAt.getTime() - now.getTime())}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      Next: {nextEvent.job.name}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold">—</p>
                    <p className="text-xs text-muted-foreground">No upcoming runs</p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Timeline ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : grouped.length === 0 && noNextRunJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-20">
          <CalendarClock className="h-12 w-12 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">No upcoming scheduled runs</p>
          <p className="text-xs text-muted-foreground/60">
            Enable schedules on your jobs to see them here
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(({ date, events: dayEvents }) => {
            const isToday = date.toDateString() === todayStr
            return (
              <div key={date.toDateString()}>
                {/* Day header */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center rounded-lg px-3 py-1.5 min-w-14 text-center',
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      {DAY_NAMES[date.getDay()]}
                    </span>
                    <span className="text-lg font-bold leading-tight">{date.getDate()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{formatDayLabel(date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {dayEvents.length} job{dayEvents.length !== 1 ? 's' : ''} scheduled
                    </p>
                  </div>
                </div>

                {/* Events */}
                <div className="flex flex-col gap-2">
                  {dayEvents.map((ev) => {
                    const msUntil = ev.nextRunAt.getTime() - now.getTime()
                    const isRunning = ev.job.status === 'running'
                    const isImminent = msUntil > 0 && msUntil < 5 * 60 * 1000

                    return (
                      <div
                        key={ev.job.id}
                        className={cn(
                          'flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors',
                          isRunning && 'border-primary/40 bg-primary/5',
                          isImminent && !isRunning && 'border-orange-500/30 bg-orange-500/5',
                          !isRunning && !isImminent && 'bg-card hover:bg-muted/30'
                        )}
                      >
                        {/* Time column */}
                        <div className="text-center min-w-14 shrink-0">
                          <p className="text-sm font-mono font-semibold">
                            {formatTime(ev.nextRunAt)}
                          </p>
                          {msUntil > 0 && (
                            <p
                              className={cn(
                                'text-[10px] font-mono',
                                isImminent
                                  ? 'text-orange-500 font-semibold'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {formatCountdown(msUntil)}
                            </p>
                          )}
                        </div>

                        <Separator orientation="vertical" className="h-8 shrink-0" />

                        {/* Job info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{ev.job.name}</p>
                            {isRunning && (
                              <Badge variant="default" className="text-[10px] h-4 px-1.5 shrink-0">
                                Running
                              </Badge>
                            )}
                            {isImminent && !isRunning && (
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 px-1.5 shrink-0 border-orange-500/50 text-orange-500"
                              >
                                Soon
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {describeSchedule(ev.schedule)}
                          </p>
                        </div>

                        {/* Right badges */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                            {ev.job.type === 'action' ? 'Action' : 'Query'}
                          </Badge>
                          {ev.runCount > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              <Play className="inline h-2.5 w-2.5 mr-0.5 -mt-px" />
                              {ev.runCount} run{ev.runCount !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Jobs with no upcoming run */}
          {noNextRunJobs.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center justify-center rounded-lg px-3 py-1.5 min-w-14 text-center bg-muted/40 text-muted-foreground/40">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">No upcoming run</p>
                  <p className="text-xs text-muted-foreground/60">
                    {noNextRunJobs.length} job{noNextRunJobs.length !== 1 ? 's' : ''} with no next
                    run scheduled
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {noNextRunJobs.map((job) => {
                  const cfg = parseScheduleConfig(job.schedule)
                  return (
                    <div
                      key={job.id}
                      className="flex items-center gap-4 rounded-lg border border-dashed px-4 py-3 opacity-50"
                    >
                      <div className="min-w-14 text-center shrink-0">
                        <p className="text-xs text-muted-foreground">—</p>
                      </div>
                      <Separator orientation="vertical" className="h-8 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{job.name}</p>
                        {cfg && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {describeSchedule(cfg)}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">
                        {job.type === 'action' ? 'Action' : 'Query'}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
