import { testConnection } from './sql-connector'
import { connection } from '../../db/repositories/connection.repository'
import type { WebContents } from 'electron'

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

  webContents.send('connections:test-progress', { id, status: 'testing', error: null })
  try {
    const test = await testConnection(conn, timeoutSec)
    const status = test.success ? 'online' : 'offline'
    connection.update(id, { status })
    webContents.send('connections:test-progress', { id, status, error: test.error })
    return status
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    connection.update(id, { status: 'offline' })
    webContents.send('connections:test-progress', { id, status: 'offline', error })
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
