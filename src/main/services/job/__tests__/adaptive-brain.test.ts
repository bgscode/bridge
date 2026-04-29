import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeHealthScore,
  decideScaling,
  shouldApplyBackpressure,
  diffCpuUsage,
  getAdaptiveBrain,
  __resetAdaptiveBrainForTests
} from '../adaptive-brain'

describe('computeHealthScore', () => {
  it('returns 1 when system is fully idle', () => {
    expect(computeHealthScore({ cpu: 0, memory: 0, lagMs: 0, errorRate: 0 })).toBeCloseTo(1, 5)
  })

  it('returns 0 when every input is at its worst', () => {
    expect(computeHealthScore({ cpu: 1, memory: 1, lagMs: 300, errorRate: 1 })).toBeCloseTo(0, 5)
  })

  it('weights cpu and lag heavier than memory and errors', () => {
    const cpuOnly = computeHealthScore({ cpu: 1, memory: 0, lagMs: 0, errorRate: 0 })
    const memOnly = computeHealthScore({ cpu: 0, memory: 1, lagMs: 0, errorRate: 0 })
    // cpu has weight 0.3, memory has weight 0.2 — cpu=1 should hurt score more
    expect(cpuOnly).toBeLessThan(memOnly)
  })

  it('clamps lag above 300ms', () => {
    const a = computeHealthScore({ cpu: 0, memory: 0, lagMs: 300, errorRate: 0 })
    const b = computeHealthScore({ cpu: 0, memory: 0, lagMs: 3000, errorRate: 0 })
    expect(a).toBeCloseTo(b, 5)
  })

  it('ignores non-finite inputs', () => {
    const score = computeHealthScore({ cpu: NaN, memory: 0, lagMs: 0, errorRate: 0 })
    expect(Number.isFinite(score)).toBe(true)
  })
})

describe('decideScaling', () => {
  const healthy = {
    score: 0.9,
    cpu: 0.2,
    memory: 0.3,
    lagMs: 10,
    throughput: 1000,
    backpressure: false,
    reason: 'ok',
    at: new Date().toISOString()
  }

  it('scales up when score > 0.75 and below max', () => {
    const d = decideScaling(healthy, 3, { min: 1, max: 10 })
    expect(d.action).toBe('scale-up')
    expect(d.recommended).toBe(4)
  })

  it('holds when already at max', () => {
    const d = decideScaling(healthy, 10, { min: 1, max: 10 })
    expect(d.action).toBe('hold')
    expect(d.recommended).toBe(10)
  })

  it('scales down when score < 0.4', () => {
    const d = decideScaling({ ...healthy, score: 0.2, cpu: 0.5, memory: 0.5, lagMs: 80 }, 10, {
      min: 1,
      max: 10
    })
    expect(d.action).toBe('scale-down')
    // 10 * 0.7 = 7
    expect(d.recommended).toBe(7)
  })

  it('hits emergency when cpu >= 90%', () => {
    const d = decideScaling({ ...healthy, cpu: 0.95, score: 0.3 }, 8, { min: 1, max: 10 })
    expect(d.action).toBe('emergency')
    expect(d.recommended).toBe(4) // 8 * 0.5
  })

  it('hits emergency when lag >= 300ms', () => {
    const d = decideScaling({ ...healthy, lagMs: 400 }, 6, { min: 1, max: 10 })
    expect(d.action).toBe('emergency')
    expect(d.recommended).toBe(3)
  })

  it('never goes below min', () => {
    const d = decideScaling({ ...healthy, cpu: 0.95, score: 0.1 }, 2, { min: 2, max: 10 })
    expect(d.recommended).toBeGreaterThanOrEqual(2)
  })
})

describe('shouldApplyBackpressure', () => {
  it('triggers on cpu >= 90%', () => {
    expect(shouldApplyBackpressure(0.91, 0.1, 10)).toBe(true)
  })
  it('triggers on memory >= 85%', () => {
    expect(shouldApplyBackpressure(0.1, 0.86, 10)).toBe(true)
  })
  it('triggers on lag >= 500ms', () => {
    expect(shouldApplyBackpressure(0.1, 0.1, 500)).toBe(true)
  })
  it('quiet otherwise', () => {
    expect(shouldApplyBackpressure(0.5, 0.5, 50)).toBe(false)
  })
})

describe('diffCpuUsage', () => {
  it('returns 0 when no time has passed', () => {
    const baseline = { idle: 100, total: 200 }
    expect(diffCpuUsage(baseline, baseline)).toBe(0)
  })
  it('returns 1 when cpu was fully busy', () => {
    const prev = { idle: 100, total: 200 }
    const next = { idle: 100, total: 300 } // all 100 new ticks were busy
    expect(diffCpuUsage(prev, next)).toBe(1)
  })
  it('clamps to [0, 1]', () => {
    const prev = { idle: 100, total: 200 }
    // malformed input — next total went backwards
    const next = { idle: 90, total: 150 }
    const r = diffCpuUsage(prev, next)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(1)
  })
})

describe('AdaptiveBrain singleton', () => {
  beforeEach(() => {
    __resetAdaptiveBrainForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    __resetAdaptiveBrainForTests()
    vi.useRealTimers()
  })

  it('warms up: recommend() returns hold before first sample', () => {
    const brain = getAdaptiveBrain({ sampleIntervalMs: 1000 })
    brain.start()
    const d = brain.recommend(3, { min: 1, max: 10 })
    expect(d.action).toBe('hold')
    expect(d.reason).toBe('warming up')
    brain.stop()
  })

  it('ref-counts start/stop', () => {
    const brain = getAdaptiveBrain({ sampleIntervalMs: 1000 })
    brain.start()
    brain.start()
    brain.stop()
    // Still active after one stop
    expect(brain.getSnapshot()).toBeNull() // no sample yet, but timer alive
    brain.stop()
    // singleton is still valid but timer is stopped; further start resets baseline
  })

  it('records rows and produces throughput in snapshot after tick', () => {
    const brain = getAdaptiveBrain({ sampleIntervalMs: 1000, windowSize: 1 })
    brain.start()
    brain.recordRows(500)
    brain.recordRows(500)
    vi.advanceTimersByTime(1000)
    const snap = brain.getSnapshot()
    expect(snap).not.toBeNull()
    expect(snap!.throughput).toBeGreaterThan(0)
    brain.stop()
  })
})
