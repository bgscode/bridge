import { createContext, useContext } from 'react'
import type { JobRow, JobProgress, CreateJobDto, UpdateJobDto, JobRunOptions } from '@shared/index'

export interface JobsContextValue {
  jobs: JobRow[]
  create: (data: CreateJobDto) => Promise<JobRow>
  update: (id: number, data: UpdateJobDto) => Promise<void>
  updateConnections: (id: number, connectionIds: number[]) => Promise<void>
  remove: (id: number) => Promise<void>
  removeMany: (ids: number[]) => Promise<void>
  bulkCreate: (items: CreateJobDto[]) => Promise<JobRow[]>
  run: (id: number, options?: JobRunOptions) => void
  cancel: (id: number) => void
  reload: () => void
}

export interface RunningJobsContextValue {
  runningJobs: JobProgress[]
  dismissJob: (id: number) => void
}

export const JobsContext = createContext<JobsContextValue | null>(null)
export const RunningJobsContext = createContext<RunningJobsContextValue | null>(null)

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used within JobsProvider')
  return ctx
}

/** Progress-only — subscribe here so the jobs table is not re-rendered every tick. */
export function useRunningJobs(): RunningJobsContextValue {
  const ctx = useContext(RunningJobsContext)
  if (!ctx) throw new Error('useRunningJobs must be used within JobsProvider')
  return ctx
}
