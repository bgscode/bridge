import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  jobRepoMock: {
    findById: vi.fn(),
    update: vi.fn()
  },
  connectionRepoMock: {
    findById: vi.fn()
  },
  settingsRepoMock: {
    getAll: vi.fn(() => ({ job_query_timeout: 30 }))
  },
  connectUsingBestIpMock: vi.fn(),
  readActionFileRowsMock: vi.fn(),
  existsSyncMock: vi.fn(() => true)
}))

const {
  jobRepoMock,
  connectionRepoMock,
  settingsRepoMock,
  connectUsingBestIpMock,
  readActionFileRowsMock
} = mocks

vi.mock('../../../db/repositories/job.repository', () => ({
  jobRepository: mocks.jobRepoMock
}))
vi.mock('../../../db/repositories/connection.repository', () => ({
  connection: mocks.connectionRepoMock
}))
vi.mock('../../../db/repositories/settings.repository', () => ({
  settingsRepo: mocks.settingsRepoMock
}))
vi.mock('../../connection/sql-connector', () => ({
  connectUsingBestIp: mocks.connectUsingBestIpMock
}))
vi.mock('../action-file-preview', () => ({
  readActionFileRows: mocks.readActionFileRowsMock
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: { ...actual, existsSync: mocks.existsSyncMock },
    existsSync: mocks.existsSyncMock
  }
})

import { runActionJob } from '../action-executor'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CapturedRequest {
  sql: string
  params: Record<string, unknown>
}

function makeMockPool(opts: { failQuery?: boolean } = {}): {
  pool: { request: () => unknown; close: () => Promise<void> }
  captured: CapturedRequest[]
} {
  const captured: CapturedRequest[] = []
  return {
    captured,
    pool: {
      request: () => {
        const params: Record<string, unknown> = {}
        const req: {
          input: (name: string, value: unknown) => typeof req
          query: (sql: string) => Promise<void>
        } = {
          input(name, value) {
            params[name] = value
            return req
          },
          async query(sql: string) {
            captured.push({ sql, params })
            if (opts.failQuery) {
              throw new Error('SQL failure (mock)')
            }
          }
        }
        return req
      },
      close: async () => {}
    }
  }
}

function makeWebContents(): {
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  sentEvents: unknown[]
} {
  const sentEvents: unknown[] = []
  return {
    sentEvents,
    send: vi.fn((_channel: string, payload: unknown) => {
      sentEvents.push(payload)
    }),
    isDestroyed: () => false
  }
}

function baseJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'Test Action',
    type: 'action',
    connection_ids: [10, 20],
    online_only: false,
    sql_query: [],
    destination_config: JSON.stringify({
      filePath: '/tmp/fake.csv',
      table: 'dbo.products',
      mode: 'upsert',
      keyColumns: ['id'],
      batchSize: 100,
      columnMapping: { id: 'id', price: 'price' }
    }),
    ...overrides
  }
}

function baseConnection(id: number): Record<string, unknown> {
  return {
    id,
    name: `conn-${id}`,
    status: 'online',
    host: 'localhost',
    port: 1433,
    database: 'db',
    username: 'u',
    password: 'p'
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runActionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsRepoMock.getAll.mockReturnValue({ job_query_timeout: 30 })
  })

  it('runs MERGE in batches per connection and aggregates row counts', async () => {
    jobRepoMock.findById.mockReturnValue(baseJob())
    connectionRepoMock.findById.mockImplementation((id: number) => baseConnection(id))

    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, price: i }))
    readActionFileRowsMock.mockResolvedValue({
      fileType: 'csv',
      headers: ['id', 'price'],
      rows
    })

    const poolA = makeMockPool()
    const poolB = makeMockPool()
    connectUsingBestIpMock
      .mockResolvedValueOnce({ pool: poolA.pool, connectedVia: 'A' })
      .mockResolvedValueOnce({ pool: poolB.pool, connectedVia: 'B' })

    const wc = makeWebContents()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress = await runActionJob(1, wc as any)

    // batchSize=100, 250 rows => 3 batches per connection × 2 connections = 6 queries
    expect(poolA.captured).toHaveLength(3)
    expect(poolB.captured).toHaveLength(3)
    // First batch=100, second=100, third=50
    expect(poolA.captured[2].sql).toMatch(/^MERGE /)
    expect(progress.status).toBe('success')
    expect(progress.total_rows).toBe(500) // 250 per connection * 2
    expect(progress.failed_connections).toBe(0)
    expect(progress.connections[0].rows).toBe(250)
    expect(progress.connections[1].rows).toBe(250)
  })

  it('isolates failures: one connection fails, other still succeeds', async () => {
    jobRepoMock.findById.mockReturnValue(baseJob())
    connectionRepoMock.findById.mockImplementation((id: number) => baseConnection(id))
    readActionFileRowsMock.mockResolvedValue({
      fileType: 'csv',
      headers: ['id', 'price'],
      rows: [
        { id: 1, price: 5 },
        { id: 2, price: 10 }
      ]
    })

    const poolGood = makeMockPool()
    const poolBad = makeMockPool({ failQuery: true })
    connectUsingBestIpMock
      .mockResolvedValueOnce({ pool: poolGood.pool, connectedVia: 'A' })
      .mockResolvedValueOnce({ pool: poolBad.pool, connectedVia: 'B' })

    const wc = makeWebContents()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress = await runActionJob(1, wc as any)

    expect(progress.failed_connections).toBe(1)
    expect(progress.status).toBe('success') // partial success
    expect(progress.connections[0].status).toBe('done')
    expect(progress.connections[1].status).toBe('error')
    expect(progress.connections[1].error).toMatch(/SQL failure/)
  })

  it('fails when destination_config is missing', async () => {
    jobRepoMock.findById.mockReturnValue(baseJob({ destination_config: null }))
    connectionRepoMock.findById.mockImplementation((id: number) => baseConnection(id))

    const wc = makeWebContents()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress = await runActionJob(1, wc as any)

    expect(progress.status).toBe('failed')
    expect(progress.error).toMatch(/config missing/i)
  })

  it('fails when no connections are available', async () => {
    jobRepoMock.findById.mockReturnValue(baseJob({ connection_ids: [] }))
    const wc = makeWebContents()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runActionJob(1, wc as any)).rejects.toThrow(/No valid connections/)
  })

  it('applies custom column mapping to target columns', async () => {
    jobRepoMock.findById.mockReturnValue(
      baseJob({
        destination_config: JSON.stringify({
          filePath: '/tmp/fake.csv',
          table: 'dbo.products',
          mode: 'insert',
          keyColumns: [],
          batchSize: 500,
          columnMapping: { sku: 'product_code', qty: 'quantity' }
        })
      })
    )
    connectionRepoMock.findById.mockImplementation((id: number) => baseConnection(id))
    readActionFileRowsMock.mockResolvedValue({
      fileType: 'csv',
      headers: ['sku', 'qty', 'ignored_col'],
      rows: [{ sku: 'ABC', qty: 7, ignored_col: 'x' }]
    })

    const pool = makeMockPool()
    connectUsingBestIpMock.mockResolvedValue({ pool: pool.pool, connectedVia: 'A' })

    const wc = makeWebContents()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress = await runActionJob(1, wc as any)

    expect(progress.status).toBe('success')
    expect(pool.captured).toHaveLength(2) // 2 connections, 1 batch each
    const sql = pool.captured[0].sql
    expect(sql).toMatch(/\[product_code\]/)
    expect(sql).toMatch(/\[quantity\]/)
    expect(sql).not.toMatch(/\[ignored_col\]/)
    expect(sql).not.toMatch(/\[sku\]/)
  })
})
