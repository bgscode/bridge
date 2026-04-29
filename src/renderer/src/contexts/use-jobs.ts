import { createContext, useContext } from 'react'
import type { JobRow, JobProgress, CreateJobDto, UpdateJobDto, JobRunOptions } from '@shared/index'

export interface JobsContextValue {
  jobs: JobRow[]
  runningJobs: JobProgress[]
  create: (data: CreateJobDto) => Promise<JobRow>
  update: (id: number, data: UpdateJobDto) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: CreateJobDto[]) => Promise<JobRow[]>
  run: (id: number, options?: JobRunOptions) => void
  cancel: (id: number) => void
  dismissJob: (id: number) => void
  reload: () => void
}

export const JobsContext = createContext<JobsContextValue | null>(null)

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used within JobsProvider')
  return ctx
}
