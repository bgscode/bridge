import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { JobGroupRow } from '@shared/index'
import { JobGroupsContext } from './use-job-groups'

export function JobGroupsProvider({ children }: { children: ReactNode }): ReactNode {
  const [jobGroups, setJobGroups] = useState<JobGroupRow[]>([])

  const reload = useCallback(() => {
    window.api.jobGroups.getAll().then(setJobGroups)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (data: { name: string; description?: string | null }): Promise<JobGroupRow> => {
      const promise = window.api.jobGroups.create(data)
      toast.promise(promise, {
        loading: 'Creating job group…',
        success: 'Job group created.',
        error: (err) => (err as Error).message
      })
      const created = await promise
      setJobGroups((prev) => [created, ...prev])
      return created
    },
    []
  )

  const update = useCallback(
    async (id: number, data: { name?: string; description?: string | null }): Promise<void> => {
      const promise = window.api.jobGroups.update(id, data)
      toast.promise(promise, {
        loading: 'Saving changes…',
        success: 'Job group updated.',
        error: (err) => (err as Error).message
      })
      const updated = await promise
      if (updated) setJobGroups((prev) => prev.map((g) => (g.id === id ? updated : g)))
    },
    []
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    const promise = window.api.jobGroups.delete(id)
    toast.promise(promise, {
      loading: 'Deleting…',
      success: 'Job group deleted.',
      error: (err) => (err as Error).message
    })
    await promise
    setJobGroups((prev) => prev.filter((g) => g.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    const promise = window.api.jobGroups.deleteAll(ids)
    toast.promise(promise, {
      loading: `Deleting ${ids.length} job group(s)…`,
      success: `${ids.length} job group(s) deleted.`,
      error: (err) => (err as Error).message
    })
    await promise
    setJobGroups((prev) => prev.filter((g) => !ids.includes(g.id)))
  }, [])

  const bulkCreate = useCallback(
    async (items: { name: string; description?: string | null }[]): Promise<JobGroupRow[]> => {
      const promise = window.api.jobGroups.bulkCreate(items)
      toast.promise(promise, {
        loading: `Importing ${items.length} job group(s)…`,
        success: (c) => `${c.length} job group(s) imported.`,
        error: (err) => (err as Error).message
      })
      const created = await promise
      setJobGroups((prev) => [...created, ...prev])
      return created
    },
    []
  )

  return (
    <JobGroupsContext.Provider
      value={{ jobGroups, create, update, remove, removeMany, bulkCreate, reload }}
    >
      {children}
    </JobGroupsContext.Provider>
  )
}
