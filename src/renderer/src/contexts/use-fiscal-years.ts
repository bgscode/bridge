import { createContext, useContext } from 'react'
import type { FiscalYearRow } from '@shared/index'

export interface FiscalYearsContextValue {
  fiscalYears: FiscalYearRow[]
  create: (data: { name: string }) => Promise<FiscalYearRow>
  update: (id: number, data: { name?: string }) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: { name: string }[]) => Promise<FiscalYearRow[]>
  reload: () => void
}

export const FiscalYearsContext = createContext<FiscalYearsContextValue | null>(null)

export function useFiscalYears(): FiscalYearsContextValue {
  const ctx = useContext(FiscalYearsContext)
  if (!ctx) throw new Error('useFiscalYears must be used within FiscalYearsProvider')
  return ctx
}
