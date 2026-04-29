import type { WebContents } from 'electron'
import type { JobRow } from '@shared/index'
import { jobRepository } from '../../db/repositories/job.repository'
import { runJob, isJobRunning } from './job-executor'

// ─── Schedule Config Shape (matches form serialization) ───────────────────────

interface ScheduleConfig {
  type: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
  time?: string // HH:MM
  days?: number[] // 0-6 for weekly
  date?: string // YYYY-MM-DD for once, day-of-month string for monthly
  intervalValue?: number
  intervalUnit?: 'minutes' | 'hours'
  cron?: string // minute hour day month weekday
  repeatCount?: number // 0 = unlimited
}

// ─── Scheduler state ──────────────────────────────────────────────────────────

interface ScheduledJob {
  jobId: number
  timer: ReturnType<typeof setTimeout> | null
  intervalTimer: ReturnType<typeof setInterval> | null
  runCount: number
  nextRunAt: string | null
}

const scheduledJobs = new Map<number, ScheduledJob>()
let schedulerWebContents: WebContents | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null

// ─── Public API ───────────────────────────────────────────────────────────────

export function startScheduler(webContents: WebContents): void {
  schedulerWebContents = webContents
  loadAllSchedules()

  // Re-check every 30 seconds for schedule changes (e.g. user edits a job)
  if (checkInterval) clearInterval(checkInterval)
  checkInterval = setInterval(() => {
    loadAllSchedules()
  }, 30_000)
}

export function stopScheduler(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }

  for (const [, sj] of scheduledJobs) {
    if (sj.timer) clearTimeout(sj.timer)
    if (sj.intervalTimer) clearInterval(sj.intervalTimer)
  }
  scheduledJobs.clear()
  schedulerWebContents = null
}

export function restartScheduler(webContents: WebContents): void {
  stopScheduler()
  startScheduler(webContents)
}

export function getSchedulerStatus(): {
  jobId: number
  nextRunAt: string | null
  runCount: number
}[] {
  const result: { jobId: number; nextRunAt: string | null; runCount: number }[] = []
  for (const [jobId, sj] of scheduledJobs) {
    result.push({ jobId, nextRunAt: sj.nextRunAt, runCount: sj.runCount })
  }
  return result
}

export function rescheduleJob(jobId: number): void {
  // Remove existing schedule
  const existing = scheduledJobs.get(jobId)
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer)
    if (existing.intervalTimer) clearInterval(existing.intervalTimer)
    scheduledJobs.delete(jobId)
  }

  // Re-load from DB
  const job = jobRepository.findById(jobId)
  if (job && job.schedule) {
    scheduleJob(job)
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function loadAllSchedules(): void {
  const jobs = jobRepository.findAll()
  const activeJobIds = new Set<number>()

  for (const job of jobs) {
    if (!job.schedule) continue

    activeJobIds.add(job.id)

    // Skip if already scheduled and unchanged
    if (scheduledJobs.has(job.id)) continue

    scheduleJob(job)
  }

  // Remove schedules for jobs that no longer have a schedule
  for (const [jobId, sj] of scheduledJobs) {
    if (!activeJobIds.has(jobId)) {
      if (sj.timer) clearTimeout(sj.timer)
      if (sj.intervalTimer) clearInterval(sj.intervalTimer)
      scheduledJobs.delete(jobId)
    }
  }
}

function scheduleJob(job: JobRow): void {
  let config: ScheduleConfig
  try {
    config = JSON.parse(job.schedule!) as ScheduleConfig
  } catch {
    return // Invalid schedule JSON
  }

  const sj: ScheduledJob = {
    jobId: job.id,
    timer: null,
    intervalTimer: null,
    runCount: 0,
    nextRunAt: null
  }

  switch (config.type) {
    case 'once':
      scheduleOnce(sj, config)
      break
    case 'daily':
      scheduleDaily(sj, config)
      break
    case 'weekly':
      scheduleWeekly(sj, config)
      break
    case 'monthly':
      scheduleMonthly(sj, config)
      break
    case 'interval':
      scheduleInterval(sj, config)
      break
    case 'cron':
      scheduleCron(sj, config)
      break
  }

  scheduledJobs.set(job.id, sj)
}

function executeScheduledJob(sj: ScheduledJob, config: ScheduleConfig): void {
  if (!schedulerWebContents || schedulerWebContents.isDestroyed()) return
  if (isJobRunning(sj.jobId)) return // Skip if already running

  sj.runCount++

  // Check repeat limit
  if (config.repeatCount && config.repeatCount > 0 && sj.runCount > config.repeatCount) {
    // Max runs reached — remove schedule
    if (sj.timer) clearTimeout(sj.timer)
    if (sj.intervalTimer) clearInterval(sj.intervalTimer)
    scheduledJobs.delete(sj.jobId)

    // Clear schedule from DB
    jobRepository.update(sj.jobId, { schedule: null } as Partial<JobRow>)
    return
  }

  runJob(sj.jobId, schedulerWebContents).catch(() => {
    // Job execution errors are already handled inside runJob
  })
}

// ─── Schedule type implementations ───────────────────────────────────────────

function scheduleOnce(sj: ScheduledJob, config: ScheduleConfig): void {
  if (!config.date || !config.time) return

  const target = new Date(`${config.date}T${config.time}:00`)
  const delay = target.getTime() - Date.now()

  if (delay <= 0) return // Already past

  sj.nextRunAt = target.toISOString()
  sj.timer = setTimeout(() => {
    executeScheduledJob(sj, config)
    // Once = remove after execution
    scheduledJobs.delete(sj.jobId)
    jobRepository.update(sj.jobId, { schedule: null } as Partial<JobRow>)
  }, delay)
}

function scheduleDaily(sj: ScheduledJob, config: ScheduleConfig): void {
  const time = config.time || '08:00'
  scheduleAtTime(sj, config, time, 24 * 60 * 60 * 1000)
}

function scheduleWeekly(sj: ScheduledJob, config: ScheduleConfig): void {
  const time = config.time || '08:00'
  const days = config.days || [1] // Default Monday

  const scheduleNext = (): void => {
    const now = new Date()
    const [hours, minutes] = time.split(':').map(Number)

    // Find next matching day
    let target: Date | null = null
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now)
      candidate.setDate(candidate.getDate() + offset)
      candidate.setHours(hours, minutes, 0, 0)

      if (days.includes(candidate.getDay()) && candidate.getTime() > now.getTime()) {
        target = candidate
        break
      }
    }

    if (!target) return

    sj.nextRunAt = target.toISOString()
    const delay = target.getTime() - Date.now()

    sj.timer = setTimeout(() => {
      executeScheduledJob(sj, config)
      // Schedule next occurrence
      scheduleNext()
    }, delay)
  }

  scheduleNext()
}

function scheduleMonthly(sj: ScheduledJob, config: ScheduleConfig): void {
  const time = config.time || '08:00'
  const dayOfMonth = parseInt(config.date || '1', 10)

  const scheduleNext = (): void => {
    const now = new Date()
    const [hours, minutes] = time.split(':').map(Number)

    let target = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hours, minutes, 0, 0)

    if (target.getTime() <= now.getTime()) {
      // Move to next month
      target = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth, hours, minutes, 0, 0)
    }

    sj.nextRunAt = target.toISOString()
    const delay = target.getTime() - Date.now()

    sj.timer = setTimeout(() => {
      executeScheduledJob(sj, config)
      scheduleNext()
    }, delay)
  }

  scheduleNext()
}

function scheduleInterval(sj: ScheduledJob, config: ScheduleConfig): void {
  const value = config.intervalValue || 30
  const unit = config.intervalUnit || 'minutes'
  const intervalMs = unit === 'hours' ? value * 60 * 60 * 1000 : value * 60 * 1000

  // Run immediately on first tick, then at interval
  const nextRun = new Date(Date.now() + intervalMs)
  sj.nextRunAt = nextRun.toISOString()

  sj.intervalTimer = setInterval(() => {
    executeScheduledJob(sj, config)
    sj.nextRunAt = new Date(Date.now() + intervalMs).toISOString()
  }, intervalMs)
}

function scheduleCron(sj: ScheduledJob, config: ScheduleConfig): void {
  if (!config.cron) return

  // Simple cron parser: minute hour day month weekday
  const parts = config.cron.trim().split(/\s+/)
  if (parts.length < 5) return

  const scheduleNext = (): void => {
    const nextRun = getNextCronRun(parts)
    if (!nextRun) return

    sj.nextRunAt = nextRun.toISOString()
    const delay = nextRun.getTime() - Date.now()

    if (delay <= 0) {
      // Next run is now or past, try next minute
      sj.timer = setTimeout(scheduleNext, 60_000)
      return
    }

    sj.timer = setTimeout(() => {
      executeScheduledJob(sj, config)
      // Schedule next
      sj.timer = setTimeout(scheduleNext, 1000)
    }, delay)
  }

  scheduleNext()
}

function scheduleAtTime(
  sj: ScheduledJob,
  config: ScheduleConfig,
  time: string,
  repeatIntervalMs: number
): void {
  const scheduleNext = (): void => {
    const now = new Date()
    const [hours, minutes] = time.split(':').map(Number)
    const target = new Date(now)
    target.setHours(hours, minutes, 0, 0)

    if (target.getTime() <= now.getTime()) {
      target.setTime(target.getTime() + repeatIntervalMs)
    }

    sj.nextRunAt = target.toISOString()
    const delay = target.getTime() - Date.now()

    sj.timer = setTimeout(() => {
      executeScheduledJob(sj, config)
      scheduleNext()
    }, delay)
  }

  scheduleNext()
}

// ─── Simple cron next-run calculator ──────────────────────────────────────────

function getNextCronRun(parts: string[]): Date | null {
  const [minPart, hourPart, dayPart, monthPart, weekdayPart] = parts

  const now = new Date()
  // Check each minute for next 48 hours (2880 minutes)
  for (let offset = 1; offset <= 2880; offset++) {
    const candidate = new Date(now.getTime() + offset * 60_000)
    candidate.setSeconds(0, 0)

    if (!matchesCronField(minPart, candidate.getMinutes())) continue
    if (!matchesCronField(hourPart, candidate.getHours())) continue
    if (!matchesCronField(dayPart, candidate.getDate())) continue
    if (!matchesCronField(monthPart, candidate.getMonth() + 1)) continue
    if (!matchesCronField(weekdayPart, candidate.getDay())) continue

    return candidate
  }

  return null
}

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true

  // Handle comma-separated values
  const parts = field.split(',')
  for (const part of parts) {
    // Handle ranges: 1-5
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number)
      if (value >= start && value <= end) return true
      continue
    }
    // Handle step: */5
    if (part.includes('/')) {
      const [, step] = part.split('/')
      if (value % Number(step) === 0) return true
      continue
    }
    // Exact match
    if (Number(part) === value) return true
  }

  return false
}
