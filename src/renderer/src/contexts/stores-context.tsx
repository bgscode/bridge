import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { StoreRow } from '@shared/index'
import { StoresContext } from './use-stores'

// ─── Provider ────────────────────────────────────────────────────────────────

export function StoresProvider({ children }: { children: ReactNode }): ReactNode {
  const [stores, setStores] = useState<StoreRow[]>([])

  const reload = useCallback(() => {
    window.api.stores.getAll().then(setStores)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(async (data: { name: string; code: string }): Promise<StoreRow> => {
    const promise = window.api.stores.create(data)
    toast.promise(promise, {
      loading: 'Creating store…',
      success: 'Store created.',
      error: (err) => (err as Error).message
    })
    const created = await promise
    setStores((prev) => [created, ...prev])
    return created
  }, [])

  const update = useCallback(
    async (id: number, data: { name?: string; code?: string }): Promise<void> => {
      const promise = window.api.stores.update(id, data)
      toast.promise(promise, {
        loading: 'Saving changes…',
        success: 'Store updated.',
        error: (err) => (err as Error).message
      })
      const updated = await promise
      if (updated) setStores((prev) => prev.map((s) => (s.id === id ? updated : s)))
    },
    []
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    await toast.promise(window.api.stores.delete(id), {
      loading: 'Deleting…',
      success: 'Store deleted.',
      error: (err) => (err as Error).message
    })
    setStores((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    await toast.promise(window.api.stores.deleteAll(ids), {
      loading: `Deleting ${ids.length} store(s)…`,
      success: `${ids.length} store(s) deleted.`,
      error: (err) => (err as Error).message
    })
    setStores((prev) => prev.filter((s) => !ids.includes(s.id)))
  }, [])

  const bulkCreate = useCallback(
    async (items: { name: string; code: string }[]): Promise<StoreRow[]> => {
      const promise = window.api.stores.bulkCreate(items)
      toast.promise(promise, {
        loading: `Importing ${items.length} store(s)…`,
        success: (c) => `${c.length} store(s) imported.`,
        error: (err) => (err as Error).message
      })
      const created = await promise
      setStores((prev) => [...created, ...prev])
      return created
    },
    []
  )

  return (
    <StoresContext.Provider
      value={{ stores, create, update, remove, removeMany, bulkCreate, reload }}
    >
      {children}
    </StoresContext.Provider>
  )
}
