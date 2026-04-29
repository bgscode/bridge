import { Badge } from '@renderer/components/ui/badge'
import { ConnectionRow } from '@shared/index'
import { Loader2, ServerCrash, Wifi, WifiOff } from 'lucide-react'
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

export { StatusBadge }
