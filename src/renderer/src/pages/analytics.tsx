import { JSX, useMemo } from 'react'
import { Activity, BriefcaseBusiness, CheckCircle2, Clock, PlayCircle, XCircle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useJobs } from '@/contexts'
import { useConnections } from '@/contexts'
import type { JobRow } from '@shared/index'

// ─── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  icon: JSX.Element
  variant?: 'default' | 'green' | 'red' | 'amber' | 'blue'
  sub?: string
}

function StatCard({ label, value, icon, variant = 'default', sub }: StatCardProps): JSX.Element {
  const cls = cn(
    'flex size-9 items-center justify-center rounded-lg',
    variant === 'green' && 'bg-emerald-500/10 text-emerald-500',
    variant === 'red' && 'bg-destructive/10 text-destructive',
    variant === 'amber' && 'bg-amber-500/10 text-amber-500',
    variant === 'blue' && 'bg-blue-500/10 text-blue-500',
    variant === 'default' && 'bg-muted text-muted-foreground'
  )
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className={cls}>{icon}</div>
          <span className="text-2xl font-bold tabular-nums">{value}</span>
        </div>
        <div className="mt-3">
          <p className="text-sm font-medium">{label}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Chart configs ────────────────────────────────────────────────────────────

const statusConfig: ChartConfig = {
  idle: { label: 'Idle', color: 'var(--color-muted-foreground)' },
  running: { label: 'Running', color: 'var(--color-chart-1)' },
  success: { label: 'Success', color: 'var(--color-chart-2)' },
  failed: { label: 'Failed', color: 'var(--color-destructive)' }
}

const typeConfig: ChartConfig = {
  query: { label: 'Query', color: 'var(--color-chart-1)' },
  action: { label: 'Action', color: 'var(--color-chart-3)' }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage(): JSX.Element {
  const { jobs } = useJobs()
  const { connections } = useConnections()

  const stats = useMemo(() => {
    const total = jobs.length
    const idle = jobs.filter((j) => j.status === 'idle').length
    const running = jobs.filter((j) => j.status === 'running').length
    const success = jobs.filter((j) => j.status === 'success').length
    const failed = jobs.filter((j) => j.status === 'failed').length
    const query = jobs.filter((j) => j.type === 'query').length
    const action = jobs.filter((j) => j.type === 'action').length
    const multi = jobs.filter((j) => j.is_multi).length
    const scheduled = jobs.filter((j) => j.schedule).length
    return { total, idle, running, success, failed, query, action, multi, scheduled }
  }, [jobs])

  // Status distribution for pie chart
  const statusData = useMemo(
    () =>
      [
        { name: 'idle', value: stats.idle, fill: 'var(--color-muted-foreground)' },
        { name: 'running', value: stats.running, fill: 'var(--color-chart-1)' },
        { name: 'success', value: stats.success, fill: 'var(--color-chart-2)' },
        { name: 'failed', value: stats.failed, fill: 'var(--color-destructive)' }
      ].filter((d) => d.value > 0),
    [stats]
  )

  // Type distribution for pie chart
  const typeData = useMemo(
    () =>
      [
        { name: 'query', value: stats.query, fill: 'var(--color-chart-1)' },
        { name: 'action', value: stats.action, fill: 'var(--color-chart-3)' }
      ].filter((d) => d.value > 0),
    [stats]
  )

  // Jobs per connection count (bar chart)
  const connectionUsage = useMemo(() => {
    const map = new Map<number, number>()
    for (const job of jobs) {
      const ids = Array.isArray(job.connection_ids) ? job.connection_ids : []
      for (const cid of ids) {
        map.set(cid, (map.get(cid) || 0) + 1)
      }
    }
    return connections
      .filter((c) => map.has(c.id))
      .map((c) => ({ name: c.name, jobs: map.get(c.id) ?? 0 }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 10)
  }, [jobs, connections])

  const connectionConfig: ChartConfig = {
    jobs: { label: 'Jobs', color: 'var(--color-chart-1)' }
  }

  // Recent jobs (last 10)
  const recentJobs = useMemo(() => {
    return [...jobs]
      .sort((a, b) => {
        const dateA = a.last_run_at ?? a.created_at
        const dateB = b.last_run_at ?? b.created_at
        return dateB.localeCompare(dateA)
      })
      .slice(0, 8)
  }, [jobs])

  const statusVariant: Record<
    JobRow['status'],
    'default' | 'secondary' | 'outline' | 'destructive'
  > = {
    idle: 'secondary',
    running: 'default',
    success: 'outline',
    failed: 'destructive'
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Job statistics and insights.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <StatCard
          label="Total Jobs"
          value={stats.total}
          icon={<BriefcaseBusiness className="size-4" />}
        />
        <StatCard
          label="Running"
          value={stats.running}
          icon={<PlayCircle className="size-4" />}
          variant="blue"
          sub="Currently active"
        />
        <StatCard
          label="Succeeded"
          value={stats.success}
          icon={<CheckCircle2 className="size-4" />}
          variant="green"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={<XCircle className="size-4" />}
          variant="red"
        />
        <StatCard
          label="Scheduled"
          value={stats.scheduled}
          icon={<Clock className="size-4" />}
          variant="amber"
          sub={`${stats.multi} multi-connection`}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Status distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Job Status</CardTitle>
            <CardDescription>Distribution by current status</CardDescription>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
                No jobs yet
              </div>
            ) : (
              <ChartContainer config={statusConfig} className="mx-auto aspect-square h-50">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50}>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Type distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Job Type</CardTitle>
            <CardDescription>Query vs Action jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {typeData.length === 0 ? (
              <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
                No jobs yet
              </div>
            ) : (
              <ChartContainer config={typeConfig} className="mx-auto aspect-square h-50">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={typeData} dataKey="value" nameKey="name" innerRadius={50}>
                    {typeData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Connection usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Connections</CardTitle>
            <CardDescription>Most used in jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {connectionUsage.length === 0 ? (
              <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
                No connections linked
              </div>
            ) : (
              <ChartContainer config={connectionConfig} className="h-50 w-full">
                <BarChart data={connectionUsage} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid horizontal={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={90}
                    tick={{ fontSize: 11 }}
                  />
                  <XAxis type="number" hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="jobs" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent jobs table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" />
            Recent Jobs
          </CardTitle>
          <CardDescription>Latest job activity</CardDescription>
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No jobs created yet. Create your first job to see analytics.
            </p>
          ) : (
            <div className="space-y-2">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="shrink-0">
                      {job.type}
                    </Badge>
                    <span className="text-sm font-medium truncate">{job.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {job.last_run_at ? new Date(job.last_run_at).toLocaleString() : 'Never run'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
