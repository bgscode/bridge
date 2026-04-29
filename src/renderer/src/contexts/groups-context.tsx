import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { GroupRow } from '@shared/index'
import { GroupsContext } from './use-groups'

// ─── Provider ────────────────────────────────────────────────────────────────

export function GroupsProvider({ children }: { children: ReactNode }): ReactNode {
  const [groups, setGroups] = useState<GroupRow[]>([])

  const reload = useCallback(() => {
    window.api.groups.getAll().then(setGroups)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (data: { name: string; description?: string | null }): Promise<GroupRow> => {
      const promise = window.api.groups.create(data)
      toast.promise(promise, {
        loading: 'Creating group…',
        success: 'Group created.',
        error: (err) => (err as Error).message
      })
      const created = await promise
      setGroups((prev) => [created, ...prev])
      return created
    },
    []
  )

  const update = useCallback(
    async (id: number, data: { name?: string; description?: string | null }): Promise<void> => {
      const promise = window.api.groups.update(id, data)
      toast.promise(promise, {
        loading: 'Saving changes…',
        success: 'Group updated.',
        error: (err) => (err as Error).message
      })
      const updated = await promise
      if (updated) setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)))
    },
    []
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    const promise = window.api.groups.delete(id)
    toast.promise(promise, {
      loading: 'Deleting…',
      success: 'Group deleted.',
      error: (err) => (err as Error).message
    })
    await promise
    setGroups((prev) => prev.filter((g) => g.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    const promise = window.api.groups.deleteAll(ids)
    toast.promise(promise, {
      loading: `Deleting ${ids.length} group(s)…`,
      success: `${ids.length} group(s) deleted.`,
      error: (err) => (err as Error).message
    })
    await promise
    setGroups((prev) => prev.filter((g) => !ids.includes(g.id)))
  }, [])

  const bulkCreate = useCallback(
    async (items: { name: string; description?: string | null }[]): Promise<GroupRow[]> => {
      const promise = window.api.groups.bulkCreate(items)
      toast.promise(promise, {
        loading: `Importing ${items.length} group(s)…`,
        success: (c) => `${c.length} group(s) imported.`,
        error: (err) => (err as Error).message
      })
      const created = await promise
      setGroups((prev) => [...created, ...prev])
      return created
    },
    []
  )

  return (
    <GroupsContext.Provider
      value={{ groups, create, update, remove, removeMany, bulkCreate, reload }}
    >
      {children}
    </GroupsContext.Provider>
  )
}
