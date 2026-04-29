import { createContext, useContext } from 'react'
import type { GroupRow } from '@shared/index'

export interface GroupsContextValue {
  groups: GroupRow[]
  create: (data: { name: string; description?: string | null }) => Promise<GroupRow>
  update: (id: number, data: { name?: string; description?: string | null }) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: { name: string; description?: string | null }[]) => Promise<GroupRow[]>
  reload: () => void
}

export const GroupsContext = createContext<GroupsContextValue | null>(null)

export function useGroups(): GroupsContextValue {
  const ctx = useContext(GroupsContext)
  if (!ctx) throw new Error('useGroups must be used within GroupsProvider')
  return ctx
}
