import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { JobRow, JobProgress, CreateJobDto, UpdateJobDto, JobRunOptions } from '@shared/index'
import { JobsContext, RunningJobsContext } from './use-jobs'

// ─── Provider ────────────────────────────────────────────────────────────────

export function JobsProvider({ children }: { children: ReactNode }): ReactNode {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [runningJobs, setRunningJobs] = useState<JobProgress[]>([])

  const reload = useCallback(() => {
    window.api.jobs.getAll().then(setJobs)
  }, [])

  useEffect(() => {
    reload()
    // Load already-running jobs on mount
    window.api.jobs.getRunning().then(setRunningJobs)
  }, [reload])

  // Listen for progress events
  useEffect(() => {
    const handleProgress = (progress: JobProgress): void => {
      setRunningJobs((prev) => {
        const idx = prev.findIndex((p) => p.job_id === progress.job_id)
        if (
          progress.status === 'success' ||
          progress.status === 'failed' ||
          progress.status === 'cancelled'
        ) {
          // Reload the jobs list so the table reflects the latest run state.
          // Auto-dismiss is owned by `JobCard` so that CSV-combine jobs can
          // wait for the combine step to finish before disappearing.
          reload()
        }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = progress
          return next
        }
        return [...prev, progress]
      })
    }
    window.api.jobs.onProgress(handleProgress)
    return () => {
      window.api.jobs.offProgress()
    }
  }, [reload])

  const create = useCallback(async (data: CreateJobDto): Promise<JobRow> => {
    const promise = window.api.jobs.create(data)
    toast.promise(promise, {
      loading: 'Creating job…',
      success: 'Job created.',
      error: (err) => (err as Error).message
    })
    const created = await promise
    setJobs((prev) => [created, ...prev])
    return created
  }, [])

  const update = useCallback(async (id: number, data: UpdateJobDto): Promise<void> => {
    const promise = window.api.jobs.update(id, data)
    toast.promise(promise, {
      loading: 'Saving changes…',
      success: 'Job updated.',
      error: (err) => (err as Error).message
    })
    const updated = await promise
    if (updated) setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)))
  }, [])

  const updateConnections = useCallback(
    async (id: number, connectionIds: number[]): Promise<void> => {
      const promise = window.api.jobs.updateConnections(id, connectionIds)
      toast.promise(promise, {
        loading: 'Saving job connections…',
        success: 'Job connections updated.',
        error: (err) => (err as Error).message
      })
      const updated = await promise
      if (updated) setJobs((prev) => prev.map((job) => (job.id === id ? updated : job)))
    },
    []
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    const promise = window.api.jobs.delete(id)
    toast.promise(promise, {
      loading: 'Deleting…',
      success: 'Job deleted.',
      error: (err) => (err as Error).message
    })
    await promise
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: number[]): Promise<void> => {
    const promise = window.api.jobs.deleteAll(ids)
    toast.promise(promise, {
      loading: `Deleting ${ids.length} job(s)…`,
      success: `${ids.length} job(s) deleted.`,
      error: (err) => (err as Error).message
    })
    await promise
    setJobs((prev) => prev.filter((j) => !ids.includes(j.id)))
  }, [])

  const bulkCreate = useCallback(async (items: CreateJobDto[]): Promise<JobRow[]> => {
    const promise = window.api.jobs.bulkCreate(items)
    toast.promise(promise, {
      loading: `Importing ${items.length} job(s)…`,
      success: (c) => `${(c as JobRow[]).length} job(s) imported.`,
      error: (err) => (err as Error).message
    })
    const created = await promise
    setJobs((prev) => [...created, ...prev])
    return created
  }, [])

  const run = useCallback(
    (id: number, options?: JobRunOptions): void => {
      const job = jobs.find((j) => j.id === id)
      toast.info(`Running "${job?.name ?? 'Job'}"…`)
      // Optimistic row status so the table shows Running without waiting for
      // the first progress event (which lives on a separate context).
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: 'running' as const } : j))
      )
      window.api.jobs.run(id, options).catch((err: Error) => {
        toast.error(err.message)
        reload()
      })
    },
    [jobs, reload]
  )

  const cancel = useCallback((id: number): void => {
    window.api.jobs.cancel(id)
    toast.info('Cancelling job…')
  }, [])

  const dismissJob = useCallback((id: number): void => {
    setRunningJobs((prev) => prev.filter((p) => p.job_id !== id))
  }, [])

  // Keep list/actions stable while progress ticks update `runningJobs` so the
  // jobs table (and open ⋮ menus) are not remounted every progress event.
  const jobsValue = useMemo(
    () => ({
      jobs,
      create,
      update,
      updateConnections,
      remove,
      removeMany,
      bulkCreate,
      run,
      cancel,
      reload
    }),
    [
      jobs,
      create,
      update,
      updateConnections,
      remove,
      removeMany,
      bulkCreate,
      run,
      cancel,
      reload
    ]
  )

  const runningValue = useMemo(
    () => ({ runningJobs, dismissJob }),
    [runningJobs, dismissJob]
  )

  return (
    <JobsContext.Provider value={jobsValue}>
      <RunningJobsContext.Provider value={runningValue}>{children}</RunningJobsContext.Provider>
    </JobsContext.Provider>
  )
}
