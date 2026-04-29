import type { WebContents } from 'electron'
import { connection } from '../../db/repositories/connection.repository'
import { settingsRepo } from '../../db/repositories/settings.repository'
import { testConnectionById } from './connection-tester'
import type { AppSettings } from '@shared/index'

const timers = new Map<number, ReturnType<typeof setTimeout>>()
const inFlight = new Set<number>()
const retryCounts = new Map<number, number>()

let startupTimer: ReturnType<typeof setTimeout> | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null

function getNextInterval(id: number, status: string, cfg: AppSettings): number {
  if (status === 'online') {
    retryCounts.delete(id)
    return cfg.monitor_online_interval * 1000
  }

  const count = retryCounts.get(id) ?? 0
  retryCounts.set(id, count + 1)

  const delay = cfg.monitor_offline_base * 1000 * Math.pow(2, count)
  return Math.min(delay, cfg.monitor_backoff_max * 1000)
}

async function testAndReschedule(id: number, webContents: WebContents): Promise<void> {
  if (inFlight.has(id) || webContents.isDestroyed()) return

  inFlight.add(id)

  try {
    const cfg = settingsRepo.getAll()
    const status = await testConnectionById(id, webContents, cfg.monitor_connection_timeout)

    if (!webContents.isDestroyed()) {
      const delay = getNextInterval(id, status, cfg)
      timers.set(
        id,
        setTimeout(() => testAndReschedule(id, webContents), delay)
      )
    }
  } catch {
    // ignore unexpected monitor errors
  } finally {
    inFlight.delete(id)
  }
}

async function workerPool(ids: number[], webContents: WebContents, workers: number): Promise<void> {
  const queue = [...ids]

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (webContents.isDestroyed()) return
      const id = queue.shift()
      if (id == null) return
      await testAndReschedule(id, webContents)
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
}

export function startConnectionMonitor(webContents: WebContents): void {
  const cfg = settingsRepo.getAll()
  if (!cfg.monitor_enabled || !cfg.monitor_startup_test) return

  if (startupTimer !== null) {
    clearTimeout(startupTimer)
    startupTimer = null
  }

  const ids = connection.findAll().map((c) => c.id)

  startupTimer = setTimeout(() => {
    startupTimer = null
    if (!webContents.isDestroyed()) {
      void workerPool(ids, webContents, cfg.monitor_workers)
    }
  }, 500)
}

export function stopConnectionMonitor(): void {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()

  if (startupTimer !== null) {
    clearTimeout(startupTimer)
    startupTimer = null
  }

  if (restartTimer !== null) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  inFlight.clear()
  retryCounts.clear()
}

export function resetBackoff(id: number): void {
  retryCounts.delete(id)
}

export function restartMonitor(webContents: WebContents): void {
  if (restartTimer !== null) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  stopConnectionMonitor()

  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!webContents.isDestroyed()) {
      startConnectionMonitor(webContents)
    }
  }, 200)
}
