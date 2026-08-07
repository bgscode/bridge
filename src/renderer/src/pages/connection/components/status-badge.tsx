import { Badge } from '@renderer/components/ui/badge'
import { ConnectionPath, ConnectionRow } from '@shared/index'
import { Cable, Gauge, Loader2, ServerCrash, Wifi, WifiOff } from 'lucide-react'
import { JSX } from 'react'

function StatusBadge({ status }: { status: ConnectionRow['status'] | 'testing' }): JSX.Element {
  if (status === 'testing') {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        Testing
      </Badge>
    )
  }
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

function PathBadge({ via }: { via: ConnectionPath | null | undefined }): JSX.Element {
  if (via === 'static_ip') {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        <Cable className="size-3" />
        Static
      </Badge>
    )
  }
  if (via === 'vpn_ip') {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <Wifi className="size-3" />
        VPN
      </Badge>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

/** Fast &lt; 200ms, OK &lt; 1000ms, Slow otherwise. */
function latencyTone(ms: number): 'fast' | 'ok' | 'slow' {
  if (ms < 200) return 'fast'
  if (ms < 1000) return 'ok'
  return 'slow'
}

function LatencyBadge({
  ms,
  status
}: {
  ms: number | null | undefined
  status: ConnectionRow['status'] | 'testing'
}): JSX.Element {
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        …
      </span>
    )
  }
  if (ms == null || status !== 'online') {
    return <span className="text-muted-foreground">—</span>
  }

  const tone = latencyTone(ms)
  const label = tone === 'fast' ? 'Fast' : tone === 'ok' ? 'OK' : 'Slow'
  const className =
    tone === 'fast'
      ? 'gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : tone === 'ok'
        ? 'gap-1 bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30'
        : 'gap-1 bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30'

  return (
    <Badge variant="outline" className={className}>
      <Gauge className="size-3" />
      {ms} ms · {label}
    </Badge>
  )
}

export { StatusBadge, PathBadge, LatencyBadge }
