import { createContext, useContext } from 'react'
import type { JobGroupRow } from '@shared/index'

export interface JobGroupsContextValue {
  jobGroups: JobGroupRow[]
  create: (data: { name: string; description?: string | null }) => Promise<JobGroupRow>
  update: (id: number, data: { name?: string; description?: string | null }) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: { name: string; description?: string | null }[]) => Promise<JobGroupRow[]>
  reload: () => void
}

export const JobGroupsContext = createContext<JobGroupsContextValue | null>(null)

export function useJobGroups(): JobGroupsContextValue {
  const ctx = useContext(JobGroupsContext)
  if (!ctx) throw new Error('useJobGroups must be used within JobGroupsProvider')
  return ctx
}
