import { testConnection } from './sql-connector'
import { connection } from '../../db/repositories/connection.repository'
import type { WebContents } from 'electron'
import type { ConnectionPath } from '@shared/index'

export type ConnectionTestProgress = {
  id: number
  status: string
  error: string | null
  connected_via: ConnectionPath | null
  latency_ms: number | null
}

/**
 * Tests a single connection and returns its resulting status string.
 * Returning the status avoids a second findById call in the caller.
 */
export async function testConnectionById(
  id: number,
  webContents: WebContents,
  timeoutSec: number = 15
): Promise<string> {
  const conn = connection.findById(id)
  if (!conn) return 'offline'

  const testingPayload: ConnectionTestProgress = {
    id,
    status: 'testing',
    error: null,
    connected_via: conn.connected_via ?? null,
    latency_ms: conn.latency_ms ?? null
  }
  webContents.send('connections:test-progress', testingPayload)

  try {
    const test = await testConnection(conn, timeoutSec)
    const status = test.success ? 'online' : 'offline'
    connection.updateProbeResult(id, {
      status,
      connected_via: test.connectedVia,
      latency_ms: test.latencyMs
    })
    const payload: ConnectionTestProgress = {
      id,
      status,
      error: test.error,
      connected_via: test.connectedVia,
      latency_ms: test.latencyMs
    }
    webContents.send('connections:test-progress', payload)
    return status
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    connection.updateProbeResult(id, {
      status: 'offline',
      connected_via: null,
      latency_ms: null
    })
    const payload: ConnectionTestProgress = {
      id,
      status: 'offline',
      error,
      connected_via: null,
      latency_ms: null
    }
    webContents.send('connections:test-progress', payload)
    return 'offline'
  }
}

/**
 * Tests many connections using a worker-pool so all workers run in parallel.
 * `workers` defaults to 10 — tune higher for large connection counts.
 */
export async function testAllConnections(
  ids: number[],
  webContents: WebContents,
  workers: number = 10
): Promise<void> {
  const queue = [...ids]
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift()!
      await testConnectionById(id, webContents)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, ids.length) }, () => worker()))
}
