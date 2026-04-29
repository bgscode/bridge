import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { ConnectionRow, CreateConnectionDto } from '@shared/index'
import { ConnectionsContext } from './use-connections'

// ─── Provider ────────────────────────────────────────────────────────────────

export function ConnectionsProvider({ children }: { children: ReactNode }): ReactNode {
  const [connections, setConnections] = useState<ConnectionRow[]>([])

  const reload = useCallback(() => {
    window.api.connections.getAll().then(setConnections)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(async (data: CreateConnectionDto): Promise<ConnectionRow> => {
    const promise = window.api.connections.create(data)
    toast.promise(promise, {
      loading: 'Creating connection…',
      success: 'Connection created.',
      error: (err) => (err as Error).message
    })
    const created = await promise
    setConnections((prev) => [created, ...prev])
    return created
  }, [])

  const update = useCallback(
    async (id: number, data: Partial<CreateConnectionDto>): Promise<void> => {
      const promise = window.api.connections.update(id, data)
      toast.promise(promise, {
        loading: 'Saving changes…',
        success: 'Connection updated.',
        error: (err) => (err as Error).message
      })
      const updated = await promise
      if (updated) setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)))
    },
    []
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    const promise = window.api.connections.delete(id)
    toast.promise(promise, {
      loading: 'Deleting…',
      success: 'Connection deleted.',
      error: (err) => (err as Error).message
    })
    await promise
    setConnections((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    const promise = window.api.connections.deleteAll(ids)
    toast.promise(promise, {
      loading: `Deleting ${ids.length} connection(s)…`,
      success: `${ids.length} connection(s) deleted.`,
      error: (err) => (err as Error).message
    })
    await promise
    setConnections((prev) => prev.filter((c) => !ids.includes(c.id)))
  }, [])

  const bulkCreate = useCallback(async (items: CreateConnectionDto[]): Promise<ConnectionRow[]> => {
    const promise = window.api.connections.bulkCreate(items)
    toast.promise(promise, {
      loading: `Importing ${items.length} connection(s)…`,
      success: (c) => `${c.length} connection(s) imported.`,
      error: (err) => (err as Error).message
    })
    const created = await promise
    setConnections((prev) => [...created, ...prev])
    return created
  }, [])

  const bulkUpdateCredentials = useCallback(
    async (
      ids: number[],
      creds: { username?: string; password?: string }
    ): Promise<ConnectionRow[]> => {
      const promise = window.api.connections.bulkUpdateCredentials(ids, creds)
      toast.promise(promise, {
        loading: `Updating credentials on ${ids.length} connection(s)…`,
        success: (rows) => `Credentials updated on ${rows.length} connection(s).`,
        error: (err) => (err as Error).message
      })
      const updated = await promise
      const byId = new Map(updated.map((r) => [r.id, r]))
      setConnections((prev) => prev.map((c) => byId.get(c.id) ?? c))
      return updated
    },
    []
  )

  const updateStatus = useCallback((id: number, status: string) => {
    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: status as ConnectionRow['status'] } : c))
    )
  }, [])

  return (
    <ConnectionsContext.Provider
      value={{ connections, create, update, remove, removeMany, bulkCreate, bulkUpdateCredentials, reload, updateStatus }}
    >
      {children}
    </ConnectionsContext.Provider>
  )
}
