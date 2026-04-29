import { describe, it, expect } from 'vitest'
import { decideOutputFormat } from '../output-decision'

describe('decideOutputFormat', () => {
  it('picks excel for small datasets under healthy conditions', () => {
    const d = decideOutputFormat({
      totalRows: 5_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('excel')
    expect(d.downgraded).toBe(false)
  })

  it('picks excel-stream for medium datasets', () => {
    const d = decideOutputFormat({
      totalRows: 150_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('excel-stream')
  })

  it('forces csv when rows exceed 300k', () => {
    const d = decideOutputFormat({
      totalRows: 500_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('csv')
    expect(d.reason).toMatch(/rows.*>.*300k/)
  })

  it('forces csv when memory > 75%', () => {
    const d = decideOutputFormat({
      totalRows: 5_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.8
    })
    expect(d.format).toBe('csv')
    expect(d.reason).toMatch(/memory/)
  })

  it('forces csv when estimated size > 100MB', () => {
    // 5 MB rows at 256 bytes = 5*1024*1024/256 = 20480 rows ≈ 5MB
    // Need > 100MB: ~100 * 1024 * 1024 / 256 ≈ 409600 rows — already >300k trigger, so force bigger row
    const d = decideOutputFormat({
      totalRows: 50_000,
      avgRowBytes: 4096, // ~195 MB
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('csv')
    expect(d.reason).toMatch(/size/)
  })

  it('picks excel-stream when pressure is high but dataset is tiny', () => {
    const d = decideOutputFormat({
      totalRows: 1_000,
      connectionCount: 20,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('excel-stream')
    expect(d.reason).toMatch(/pressure/)
  })

  it('forces csv when pressure is high and dataset is also large', () => {
    const d = decideOutputFormat({
      totalRows: 180_000,
      connectionCount: 20,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.format).toBe('csv')
    expect(d.reason).toMatch(/pressure/)
  })

  it('honors user csv preference always', () => {
    const d = decideOutputFormat({
      totalRows: 100,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3,
      preferred: 'csv'
    })
    expect(d.format).toBe('csv')
  })

  it('downgrades excel → streaming when data suggests streaming', () => {
    const d = decideOutputFormat({
      totalRows: 150_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3,
      preferred: 'excel'
    })
    expect(d.format).toBe('excel-stream')
    expect(d.downgraded).toBe(true)
  })

  it('downgrades excel → csv under memory pressure', () => {
    const d = decideOutputFormat({
      totalRows: 1_000,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.9,
      preferred: 'excel'
    })
    expect(d.format).toBe('csv')
    expect(d.downgraded).toBe(true)
  })

  it('calculates sizeMB correctly', () => {
    const d = decideOutputFormat({
      totalRows: 1024,
      avgRowBytes: 1024,
      connectionCount: 1,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.sizeMB).toBe(1) // 1024 rows * 1024 bytes = 1 MB
  })

  it('calculates pressure correctly', () => {
    const d = decideOutputFormat({
      totalRows: 1_000,
      connectionCount: 10,
      maxParallel: 5,
      memoryUsage: 0.3
    })
    expect(d.pressure).toBe(2)
  })
})
