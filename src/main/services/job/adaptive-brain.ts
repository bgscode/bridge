/**
 * Adaptive Brain — live system health monitor that drives dynamic worker
 * scaling and backpressure decisions for the job executor.
 *
 * Samples:
 *   • CPU load  (os.cpus() diff, 0..1)
 *   • Memory    (process RSS / total system memory, 0..1)
 *   • Event loop lag (perf_hooks.monitorEventLoopDelay, ms)
 *   • Throughput (rows/sec, pushed externally via recordThroughput)
 *
 * Produces a health score in [0, 1] where 1 = system idle/healthy.
 * Recommends worker count changes per the spec in systemimplimation.md:
 *   score > 0.75 → workers + 1
 *   score < 0.4  → workers * 0.7
 *   cpu>90% OR mem>90% OR lag>300ms → workers * 0.5 (emergency)
 *   backpressure trigger: cpu>90 OR mem>85 OR lag>500
 */

import os from 'os'
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthSnapshot {
  /** 0..1, 1 = healthy/idle */
  score: number
  /** 0..1 */
  cpu: number
  /** 0..1 */
  memory: number
  /** event loop lag in ms (mean over sampling window) */
  lagMs: number
  /** rolling rows/sec throughput */
  throughput: number
  /** true when system is under heavy pressure and work should pause */
  backpressure: boolean
  /** human hint for UI */
  reason: string
  /** ISO timestamp of this snapshot */
  at: string
}

export interface ScalingDecision {
  /** recommended worker count given current workers and min/max bounds */
  recommended: number
  /** 'emergency' | 'scale-down' | 'scale-up' | 'hold' */
  action: 'emergency' | 'scale-down' | 'scale-up' | 'hold'
  reason: string
}

export interface BrainOptions {
  /** sampling interval in ms (default 1000) */
  sampleIntervalMs?: number
  /** scaling-decision cooldown in ms (default 5000) */
  cooldownMs?: number
  /** smoothing window size (samples) for cpu/lag/throughput (default 5) */
  windowSize?: number
}

// ─── Rolling helpers ──────────────────────────────────────────────────────────

class RollingAvg {
  private readonly buf: number[] = []
  constructor(private readonly size: number) {}
  push(v: number): void {
    this.buf.push(v)
    if (this.buf.length > this.size) this.buf.shift()
  }
  get value(): number {
    if (this.buf.length === 0) return 0
    let s = 0
    for (const v of this.buf) s += v
    return s / this.buf.length
  }
  reset(): void {
    this.buf.length = 0
  }
}

// ─── CPU sampling (diff-based) ────────────────────────────────────────────────

interface CpuBaseline {
  idle: number
  total: number
}

function readCpuBaseline(): CpuBaseline {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t
    idle += c.times.idle
  }
  return { idle, total }
}

/** Returns 0..1 CPU usage since `prev`. Returns 0 if `prev` is invalid. */
export function diffCpuUsage(prev: CpuBaseline, next: CpuBaseline): number {
  const idleDiff = next.idle - prev.idle
  const totalDiff = next.total - prev.total
  if (totalDiff <= 0) return 0
  const usage = 1 - idleDiff / totalDiff
  return Math.min(1, Math.max(0, usage))
}

// ─── Pure decision functions (exported for testing) ───────────────────────────

/** PRD formula — cpu 0.3, mem 0.2, lag 0.3, errors 0.2. All inputs 0..1. */
export function computeHealthScore(input: {
  cpu: number
  memory: number
  lagMs: number
  errorRate: number
}): number {
  const cpuScore = 1 - clamp01(input.cpu)
  const memScore = 1 - clamp01(input.memory)
  // lag: 0ms=perfect, ≥300ms=worst
  const lagScore = 1 - clamp01(input.lagMs / 300)
  const errScore = 1 - clamp01(input.errorRate)
  return clamp01(cpuScore * 0.3 + memScore * 0.2 + lagScore * 0.3 + errScore * 0.2)
}

export function decideScaling(
  snapshot: HealthSnapshot,
  currentWorkers: number,
  bounds: { min: number; max: number }
): ScalingDecision {
  const { min, max } = bounds
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))

  // Emergency: hard thresholds
  if (snapshot.cpu >= 0.9 || snapshot.memory >= 0.9 || snapshot.lagMs >= 300) {
    return {
      recommended: clamp(Math.max(min, Math.floor(currentWorkers * 0.5))),
      action: 'emergency',
      reason: `emergency: cpu=${(snapshot.cpu * 100).toFixed(0)}% mem=${(snapshot.memory * 100).toFixed(0)}% lag=${snapshot.lagMs.toFixed(0)}ms`
    }
  }

  if (snapshot.score < 0.4) {
    return {
      recommended: clamp(Math.max(min, Math.floor(currentWorkers * 0.7))),
      action: 'scale-down',
      reason: `low health (${snapshot.score.toFixed(2)})`
    }
  }

  if (snapshot.score > 0.75 && currentWorkers < max) {
    return {
      recommended: clamp(currentWorkers + 1),
      action: 'scale-up',
      reason: `healthy (${snapshot.score.toFixed(2)})`
    }
  }

  return {
    recommended: clamp(currentWorkers),
    action: 'hold',
    reason: 'stable'
  }
}

export function shouldApplyBackpressure(cpu: number, memory: number, lagMs: number): boolean {
  return cpu >= 0.9 || memory >= 0.85 || lagMs >= 500
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

// ─── Adaptive Brain singleton ────────────────────────────────────────────────

type Listener = (s: HealthSnapshot) => void

class AdaptiveBrain {
  private timer: ReturnType<typeof setInterval> | null = null
  private loopMonitor: IntervalHistogram | null = null
  private cpuBaseline: CpuBaseline = readCpuBaseline()
  private readonly cpuAvg: RollingAvg
  private readonly lagAvg: RollingAvg
  private readonly memAvg: RollingAvg
  private readonly throughputAvg: RollingAvg
  private rowsInWindow = 0
  private windowStart = Date.now()
  private errorRate = 0
  private listeners = new Set<Listener>()
  private lastSnapshot: HealthSnapshot | null = null
  private lastDecisionAt = 0
  private refCount = 0

  constructor(private readonly opts: Required<BrainOptions>) {
    this.cpuAvg = new RollingAvg(opts.windowSize)
    this.lagAvg = new RollingAvg(opts.windowSize)
    this.memAvg = new RollingAvg(opts.windowSize)
    this.throughputAvg = new RollingAvg(opts.windowSize)
  }

  /** Ref-counted start — call once per active job. */
  start(): void {
    this.refCount++
    if (this.timer) return

    this.cpuBaseline = readCpuBaseline()
    this.loopMonitor = monitorEventLoopDelay({ resolution: 20 })
    this.loopMonitor.enable()
    this.rowsInWindow = 0
    this.windowStart = Date.now()

    this.timer = setInterval(() => this.sample(), this.opts.sampleIntervalMs)
    // Don't keep the process alive just for sampling
    this.timer.unref?.()
  }

  /** Ref-counted stop — call once per active job. Stops sampling at 0. */
  stop(): void {
    if (this.refCount > 0) this.refCount--
    if (this.refCount > 0) return

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.loopMonitor) {
      this.loopMonitor.disable()
      this.loopMonitor = null
    }
    this.cpuAvg.reset()
    this.lagAvg.reset()
    this.memAvg.reset()
    this.throughputAvg.reset()
    this.lastSnapshot = null
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** External callers push row counts as they stream (for throughput). */
  recordRows(n: number): void {
    this.rowsInWindow += n
  }

  /** 0..1 rolling error ratio (failed / total). Called by executor. */
  setErrorRate(rate: number): void {
    this.errorRate = clamp01(rate)
  }

  getSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot
  }

  /** Returns a scaling decision, honoring cooldown so scaling is stable. */
  recommend(currentWorkers: number, bounds: { min: number; max: number }): ScalingDecision {
    const snap = this.lastSnapshot
    if (!snap) {
      return {
        recommended: Math.min(bounds.max, Math.max(bounds.min, currentWorkers)),
        action: 'hold',
        reason: 'warming up'
      }
    }

    const now = Date.now()
    const emergency = snap.cpu >= 0.9 || snap.memory >= 0.9 || snap.lagMs >= 300
    if (!emergency && now - this.lastDecisionAt < this.opts.cooldownMs) {
      return {
        recommended: Math.min(bounds.max, Math.max(bounds.min, currentWorkers)),
        action: 'hold',
        reason: 'cooldown'
      }
    }

    this.lastDecisionAt = now
    return decideScaling(snap, currentWorkers, bounds)
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private sample(): void {
    const nextBaseline = readCpuBaseline()
    const cpu = diffCpuUsage(this.cpuBaseline, nextBaseline)
    this.cpuBaseline = nextBaseline
    this.cpuAvg.push(cpu)

    // Track OUR process memory, not system-wide. On macOS system free memory
    // is nearly always <15% due to file cache, which would otherwise pin
    // backpressure permanently on and stall every worker pick.
    const totalMem = os.totalmem()
    const rss = process.memoryUsage().rss
    const mem = totalMem > 0 ? Math.min(1, rss / totalMem) : 0
    this.memAvg.push(mem)

    const lagMs = this.loopMonitor ? this.loopMonitor.mean / 1e6 : 0
    this.lagAvg.push(lagMs)
    this.loopMonitor?.reset()

    const now = Date.now()
    const elapsedSec = Math.max(0.001, (now - this.windowStart) / 1000)
    const throughput = this.rowsInWindow / elapsedSec
    this.throughputAvg.push(throughput)
    this.rowsInWindow = 0
    this.windowStart = now

    const smoothCpu = this.cpuAvg.value
    const smoothMem = this.memAvg.value
    const smoothLag = this.lagAvg.value
    const smoothThroughput = this.throughputAvg.value

    const score = computeHealthScore({
      cpu: smoothCpu,
      memory: smoothMem,
      lagMs: smoothLag,
      errorRate: this.errorRate
    })

    const backpressure = shouldApplyBackpressure(smoothCpu, smoothMem, smoothLag)

    const reason = backpressure
      ? `pressure: cpu=${(smoothCpu * 100).toFixed(0)}% mem=${(smoothMem * 100).toFixed(0)}% lag=${smoothLag.toFixed(0)}ms`
      : `ok: score=${score.toFixed(2)}`

    const snap: HealthSnapshot = {
      score,
      cpu: smoothCpu,
      memory: smoothMem,
      lagMs: smoothLag,
      throughput: smoothThroughput,
      backpressure,
      reason,
      at: new Date(now).toISOString()
    }
    this.lastSnapshot = snap
    for (const fn of this.listeners) {
      try {
        fn(snap)
      } catch {
        // swallow listener errors
      }
    }
  }
}

let instance: AdaptiveBrain | null = null

export function getAdaptiveBrain(opts?: BrainOptions): AdaptiveBrain {
  if (!instance) {
    instance = new AdaptiveBrain({
      sampleIntervalMs: opts?.sampleIntervalMs ?? 1000,
      cooldownMs: opts?.cooldownMs ?? 5000,
      windowSize: opts?.windowSize ?? 5
    })
  }
  return instance
}

/** Test helper — resets the singleton so each test gets fresh state. */
export function __resetAdaptiveBrainForTests(): void {
  if (instance) {
    // Force stop regardless of ref count
    try {
      ;(instance as unknown as { refCount: number }).refCount = 1
      instance.stop()
    } catch {
      // ignore
    }
  }
  instance = null
}

export type { AdaptiveBrain }
