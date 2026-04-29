import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { FiscalYearRow } from '@shared/index'
import { FiscalYearsContext } from './use-fiscal-years'

// ─── Provider ────────────────────────────────────────────────────────────────

export function FiscalYearsProvider({ children }: { children: ReactNode }): ReactNode {
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([])

  const reload = useCallback(() => {
    window.api.fiscalYears.getAll().then(setFiscalYears)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(async (data: { name: string }): Promise<FiscalYearRow> => {
    const promise = window.api.fiscalYears.create(data)
    toast.promise(promise, {
      loading: 'Creating fiscal year…',
      success: 'Fiscal year created.',
      error: (err) => (err as Error).message
    })
    const created = await promise
    setFiscalYears((prev) => [created, ...prev])
    return created
  }, [])

  const update = useCallback(async (id: number, data: { name?: string }): Promise<void> => {
    const promise = window.api.fiscalYears.update(id, data)
    toast.promise(promise, {
      loading: 'Saving changes…',
      success: 'Fiscal year updated.',
      error: (err) => (err as Error).message
    })
    const updated = await promise
    if (updated) setFiscalYears((prev) => prev.map((f) => (f.id === id ? updated : f)))
  }, [])

  const remove = useCallback(async (id: number): Promise<void> => {
    await toast.promise(window.api.fiscalYears.delete(id), {
      loading: 'Deleting…',
      success: 'Fiscal year deleted.',
      error: (err) => (err as Error).message
    })
    setFiscalYears((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    await toast.promise(window.api.fiscalYears.deleteAll(ids), {
      loading: `Deleting ${ids.length} fiscal year(s)…`,
      success: `${ids.length} fiscal year(s) deleted.`,
      error: (err) => (err as Error).message
    })
    setFiscalYears((prev) => prev.filter((f) => !ids.includes(f.id)))
  }, [])

  const bulkCreate = useCallback(async (items: { name: string }[]): Promise<FiscalYearRow[]> => {
    const promise = window.api.fiscalYears.bulkCreate(items)
    toast.promise(promise, {
      loading: `Importing ${items.length} fiscal year(s)…`,
      success: (c) => `${c.length} fiscal year(s) imported.`,
      error: (err) => (err as Error).message
    })
    const created = await promise
    setFiscalYears((prev) => [...created, ...prev])
    return created
  }, [])

  return (
    <FiscalYearsContext.Provider
      value={{ fiscalYears, create, update, remove, removeMany, bulkCreate, reload }}
    >
      {children}
    </FiscalYearsContext.Provider>
  )
}
