/**
 * Tests for connection-monitor.ts
 *
 * Strategy: mock all external deps (DB repos, connection-tester) so we can
 * drive the monitor purely in-process with fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WebContents } from 'electron'
import type { AppSettings } from '@shared/index'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock electron so db/index.ts doesn't crash (it calls app.getPath at module load)
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/bridge-test') }
}))

// Mock the DB module itself to prevent SQLite from being initialised
vi.mock('../../../db/index', () => ({ default: {} }))

const mockFindAll = vi.fn()
const mockGetAll = vi.fn()
const mockTestConnectionById = vi.fn()

vi.mock('../../../db/repositories/connection.repository', () => ({
  connection: { findAll: mockFindAll }
}))

vi.mock('../../../db/repositories/settings.repository', () => ({
  settingsRepo: { getAll: mockGetAll }
}))

vi.mock('../connection-tester', () => ({
  testConnectionById: mockTestConnectionById
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWebContents(destroyed = false): WebContents {
  return {
    isDestroyed: vi.fn(() => destroyed)
  } as unknown as WebContents
}

function defaultSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    monitor_enabled: true,
    monitor_startup_test: true,
    monitor_workers: 2,
    monitor_online_interval: 30, // seconds
    monitor_offline_base: 5, // seconds
    monitor_backoff_max: 60, // seconds
    monitor_connection_timeout: 5, // seconds
    ...overrides
  }
}

// ─── Import SUT after mocks are set up ────────────────────────────────────────

// Dynamic import so vi.mock() above takes effect first
const { startConnectionMonitor, stopConnectionMonitor, restartMonitor, resetBackoff } =
  await import('../connection-monitor')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('connection-monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetAll.mockReturnValue(defaultSettings())
    mockFindAll.mockReturnValue([])
    // testConnectionById now returns the status string
    mockTestConnectionById.mockResolvedValue('online')
  })

  afterEach(() => {
    stopConnectionMonitor()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── startConnectionMonitor ─────────────────────────────────────────────────

  describe('startConnectionMonitor', () => {
    it('does NOT start when monitor_startup_test is false', async () => {
      mockGetAll.mockReturnValue(defaultSettings({ monitor_startup_test: false }))
      mockFindAll.mockReturnValue([{ id: 1 }, { id: 2 }])
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })

    it('does nothing when there are no connections', async () => {
      mockFindAll.mockReturnValue([])
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })

    it('tests all connections on startup via worker pool', async () => {
      const connections = [{ id: 1 }, { id: 2 }, { id: 3 }]
      mockFindAll.mockReturnValue(connections)
      // Return 'online' so reschedule delay is long (30s) — next fire won't happen during test
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      // Advance past the 500ms startup delay; tests resolve instantly
      await vi.advanceTimersByTimeAsync(600)

      expect(mockTestConnectionById).toHaveBeenCalledTimes(3)
      const calledIds = mockTestConnectionById.mock.calls.map((c) => c[0])
      expect(calledIds.sort()).toEqual([1, 2, 3])
    })

    it('passes the connection timeout from settings', async () => {
      mockFindAll.mockReturnValue([{ id: 10 }])
      mockTestConnectionById.mockResolvedValue('online')
      mockGetAll.mockReturnValue(defaultSettings({ monitor_connection_timeout: 8 }))
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600)

      expect(mockTestConnectionById).toHaveBeenCalledWith(10, wc, 8)
    })

    it('skips test when webContents is destroyed', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      const wc = makeWebContents(true) // destroyed

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })

    it('cancels a pending startup timer when stopped before 500ms', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(200)

      stopConnectionMonitor()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })

    it('replaces an existing pending startup timer on repeated starts', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(300)

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(499)
      expect(mockTestConnectionById).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(1)
    })
  })

  // ── getNextInterval / backoff ──────────────────────────────────────────────

  describe('exponential backoff rescheduling', () => {
    it('reschedules with online interval when connection is online', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // first test fires
      expect(mockTestConnectionById).toHaveBeenCalledTimes(1)

      // Second test fires after monitor_online_interval (30s)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(2)
    })

    it('reschedules with exponential backoff when connection is offline', async () => {
      mockFindAll.mockReturnValue([{ id: 2 }])
      mockTestConnectionById.mockResolvedValue('offline')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // test 1 at t=500ms
      expect(mockTestConnectionById).toHaveBeenCalledTimes(1)

      // 1st retry: base=5s * 2^0 = 5s
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(2)

      // 2nd retry: 5s * 2^1 = 10s
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(3)

      // 3rd retry: 5s * 2^2 = 20s
      await vi.advanceTimersByTimeAsync(20_000)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(4)
    })

    it('caps backoff at monitor_backoff_max', async () => {
      // base=5s, max=15s → after 2 retries (5s, 10s) next would be 20s but capped at 15s
      mockGetAll.mockReturnValue(
        defaultSettings({ monitor_offline_base: 5, monitor_backoff_max: 15 })
      )
      mockFindAll.mockReturnValue([{ id: 3 }])
      mockTestConnectionById.mockResolvedValue('offline')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // test 1
      await vi.advanceTimersByTimeAsync(5_000) // retry 1 (5s)
      await vi.advanceTimersByTimeAsync(10_000) // retry 2 (10s)
      const callsBeforeCap = mockTestConnectionById.mock.calls.length

      // retry 3 would be 20s but capped → fires at exactly 15s
      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockTestConnectionById.mock.calls.length).toBe(callsBeforeCap + 1)

      // Should NOT fire again within the remaining 5s (it was capped at 15, not 20)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(mockTestConnectionById.mock.calls.length).toBe(callsBeforeCap + 1)
    })
  })

  // ── resetBackoff ───────────────────────────────────────────────────────────

  describe('resetBackoff', () => {
    it('resets retry count so next offline interval starts from base again', async () => {
      mockFindAll.mockReturnValue([{ id: 5 }])
      mockTestConnectionById.mockResolvedValue('offline')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // test 1
      await vi.advanceTimersByTimeAsync(5_000) // retry 1 (5s)
      await vi.advanceTimersByTimeAsync(10_000) // retry 2 (10s) — count is now 2

      // Reset backoff — next interval restarts from base (5s)
      resetBackoff(5)
      mockTestConnectionById.mockClear()

      await vi.advanceTimersByTimeAsync(20_000) // without reset would be 20s
      // With reset the timer was already scheduled for 20s (count=2 was set before reset)
      // After THAT fires, the NEXT one should be base=5s
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(2)
    })
  })

  // ── stopConnectionMonitor ─────────────────────────────────────────────────

  describe('stopConnectionMonitor', () => {
    it('cancels all scheduled timers — no more tests fire', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }, { id: 2 }])
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // let initial tests run

      stopConnectionMonitor()
      mockTestConnectionById.mockClear()

      // Nothing should fire even after a long wait
      await vi.advanceTimersByTimeAsync(120_000)
      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })
  })

  // ── restartMonitor ─────────────────────────────────────────────────────────

  describe('restartMonitor', () => {
    it('stops and restarts the monitor after 200ms', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      restartMonitor(wc)
      expect(mockTestConnectionById).not.toHaveBeenCalled() // not yet

      // 200ms debounce + 500ms startup
      await vi.advanceTimersByTimeAsync(200 + 600)
      expect(mockTestConnectionById).toHaveBeenCalledTimes(1)
    })

    it('debounces — multiple rapid calls result in only ONE restart', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      // Call 5 times rapidly — only the last 200ms window should fire
      restartMonitor(wc)
      restartMonitor(wc)
      restartMonitor(wc)
      restartMonitor(wc)
      restartMonitor(wc)

      await vi.advanceTimersByTimeAsync(200 + 600)

      // Only 1 startup cycle should have run — 1 connection tested once
      expect(mockTestConnectionById).toHaveBeenCalledTimes(1)
    })

    it('does NOT start monitor if webContents destroyed before 200ms', async () => {
      const wc = makeWebContents(true) // destroyed immediately

      restartMonitor(wc)
      await vi.advanceTimersByTimeAsync(800)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })

    it('does not restart when stopConnectionMonitor clears the pending debounce', async () => {
      mockFindAll.mockReturnValue([{ id: 1 }])
      const wc = makeWebContents()

      restartMonitor(wc)
      await vi.advanceTimersByTimeAsync(100)

      stopConnectionMonitor()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(mockTestConnectionById).not.toHaveBeenCalled()
    })
  })

  // ── in-flight guard ────────────────────────────────────────────────────────

  describe('in-flight guard', () => {
    it('skips a connection if it is already being tested', async () => {
      let resolveTest!: () => void
      // First test hangs
      mockTestConnectionById.mockReturnValueOnce(
        new Promise<void>((res) => {
          resolveTest = res
        })
      )
      mockFindAll.mockReturnValue([{ id: 7 }])
      mockTestConnectionById.mockResolvedValue('online')
      const wc = makeWebContents()

      startConnectionMonitor(wc)
      await vi.advanceTimersByTimeAsync(600) // first test fires, still in-flight

      // The connection is in-flight so rescheduling has NOT happened yet.
      // If guard was absent, a second test might start — it shouldn't.
      mockTestConnectionById.mockClear()
      await vi.advanceTimersByTimeAsync(30_000) // advance well past online interval
      // Still in-flight — no second test
      expect(mockTestConnectionById).not.toHaveBeenCalled()

      resolveTest() // finish the first test
    })
  })
})
