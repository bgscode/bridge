import { createContext, useContext } from 'react'
import type { ConnectionPath, ConnectionRow, CreateConnectionDto } from '@shared/index'

export interface ConnectionStatusPatch {
  status: string
  connected_via?: ConnectionPath | null
  latency_ms?: number | null
}

export interface ConnectionsContextValue {
  connections: ConnectionRow[]
  create: (data: CreateConnectionDto) => Promise<ConnectionRow>
  update: (id: number, data: Partial<CreateConnectionDto>) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: CreateConnectionDto[]) => Promise<ConnectionRow[]>
  bulkUpdateCredentials: (
    ids: number[],
    creds: { username?: string; password?: string }
  ) => Promise<ConnectionRow[]>
  reload: () => void
  updateStatus: (id: number, patch: string | ConnectionStatusPatch) => void
}

export const ConnectionsContext = createContext<ConnectionsContextValue | null>(null)

export function useConnections(): ConnectionsContextValue {
  const ctx = useContext(ConnectionsContext)
  if (!ctx) throw new Error('useConnections must be used within ConnectionsProvider')
  return ctx
}
