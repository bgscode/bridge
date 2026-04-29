import { createContext, useContext } from 'react'
import type { StoreRow } from '@shared/index'

export interface StoresContextValue {
  stores: StoreRow[]
  create: (data: { name: string; code: string }) => Promise<StoreRow>
  update: (id: number, data: { name?: string; code?: string }) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: { name: string; code: string }[]) => Promise<StoreRow[]>
  reload: () => void
}

export const StoresContext = createContext<StoresContextValue | null>(null)

export function useStores(): StoresContextValue {
  const ctx = useContext(StoresContext)
  if (!ctx) throw new Error('useStores must be used within StoresProvider')
  return ctx
}
