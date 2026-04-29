import { JSX, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarRange,
  Database,
  Layers,
  Plus,
  ServerCrash,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useConnections, useGroups, useStores, useFiscalYears } from '@/contexts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ConnectionRow } from '@shared/index'

// ─── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  icon: ReactNode
  sub?: string
  variant?: 'default' | 'green' | 'red' | 'amber'
}

function StatCard({ label, value, icon, sub, variant = 'default' }: StatCardProps): JSX.Element {
  const iconCls = cn(
    'flex size-8 items-center justify-center rounded-lg',
    variant === 'green' && 'bg-emerald-500/10 text-emerald-500',
    variant === 'red' && 'bg-destructive/10 text-destructive',
    variant === 'amber' && 'bg-amber-500/10 text-amber-500',
    variant === 'default' && 'bg-muted text-muted-foreground'
  )
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className={iconCls}>{icon}</div>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Status indicator ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ConnectionRow['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        status === 'online' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        status === 'offline' && 'bg-destructive/10 text-destructive',
        status === 'failed' && 'bg-destructive/10 text-destructive',
        status === 'unknown' && 'bg-muted text-muted-foreground'
      )}
    >
      {status}
    </span>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage(): JSX.Element {
  const { connections } = useConnections()
  const { groups } = useGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const navigate = useNavigate()

  const stats = useMemo(() => {
    const online = connections.filter((c) => c.status === 'online').length
    const offline = connections.filter((c) => c.status === 'offline').length
    const issues = connections.filter((c) => c.status === 'failed' || c.status === 'unknown').length
    const total = connections.length
    const pct = total > 0 ? Math.round((online / total) * 100) : 0
    return { online, offline, issues, total, pct }
  }, [connections])

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Connection monitor overview.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Connections"
          value={stats.total}
          icon={<Database className="size-4" />}
        />
        <StatCard
          label="Online"
          value={stats.online}
          icon={<Wifi className="size-4" />}
          variant="green"
          sub={stats.total > 0 ? `${stats.pct}% healthy` : undefined}
        />
        <StatCard
          label="Offline"
          value={stats.offline}
          icon={<WifiOff className="size-4" />}
          variant="red"
        />
        <StatCard
          label="Issues"
          value={stats.issues}
          icon={<ServerCrash className="size-4" />}
          variant="amber"
          sub="failed + unknown"
        />
      </div>

      {/* Resources row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Groups"
          value={groups.length}
          icon={<Layers className="size-4" />}
          sub={groups.length === 0 ? 'None created yet' : undefined}
        />
        <StatCard
          label="Stores"
          value={stores.length}
          icon={<Building2 className="size-4" />}
          sub={stores.length === 0 ? 'None created yet' : undefined}
        />
        <StatCard
          label="Fiscal Years"
          value={fiscalYears.length}
          icon={<CalendarRange className="size-4" />}
          sub={fiscalYears.length === 0 ? 'None created yet' : undefined}
        />
      </div>

      {/* Live connection status */}
      <div className="overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-3.5" />
            <span className="text-sm font-semibold">Live Status</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => navigate('/connection')}
          >
            View all
            <ArrowRight className="size-3" />
          </Button>
        </div>

        <div className="divide-y">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Database className="text-muted-foreground size-8 opacity-30" />
              <div>
                <p className="text-sm font-medium">No connections yet</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Add a connection to start monitoring
                </p>
              </div>
              <Button size="sm" onClick={() => navigate('/connection')}>
                <Plus className="mr-1.5 size-3" />
                New Connection
              </Button>
            </div>
          ) : (
            connections.slice(0, 8).map((conn) => {
              const group = groups.find((g) => g.id === conn.group_id)
              return (
                <div key={conn.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={cn(
                      'block size-2 shrink-0 rounded-full',
                      conn.status === 'online' && 'bg-emerald-500',
                      conn.status === 'offline' && 'bg-destructive',
                      conn.status === 'failed' && 'bg-destructive',
                      conn.status === 'unknown' && 'bg-muted-foreground/40'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{conn.name}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {conn.static_ip} · {conn.db_name}
                    </p>
                  </div>
                  {group && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground shrink-0 text-[11px] font-normal"
                    >
                      {group.name}
                    </Badge>
                  )}
                  <StatusPill status={conn.status} />
                </div>
              )
            })
          )}
        </div>

        {connections.length > 8 && (
          <div className="border-t px-5 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate('/connection')}
            >
              +{connections.length - 8} more connections
              <ArrowRight className="size-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
