import { ipcMain } from 'electron'
import { connection } from '../db/repositories/connection.repository'
import type { CreateConnectionDto, UpdateConnectionDto } from '@shared/index'
import { testAllConnections, testConnectionById } from '../services/connection/connection-tester'
import { resetBackoff } from '../services/connection/connection-monitor'
import {
  mirrorConnectionCreate,
  mirrorConnectionUpdate,
  mirrorConnectionDelete
} from '../services/sync/mirror'

function handleError(err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new Error('A connection with this name already exists.')
  }
  throw new Error(e.message ?? 'An unexpected error occurred.')
}

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:getAll', () => connection.findAll())

  ipcMain.handle('connections:create', async (_, data: CreateConnectionDto) => {
    try {
      const row = connection.create(data)
      await mirrorConnectionCreate(row)
      // Re-read so caller sees the persisted remote_id too
      return connection.findById(row.id) ?? row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('connections:bulkCreate', async (_, items: CreateConnectionDto[]) => {
    try {
      const rows = connection.bulkCreate(items)
      for (const r of rows) await mirrorConnectionCreate(r)
      return rows.map((r) => connection.findById(r.id) ?? r)
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle('connections:update', async (_, id: number, data: UpdateConnectionDto) => {
    try {
      const row = connection.update(id, data)
      if (row) await mirrorConnectionUpdate(row)
      return row
    } catch (err) {
      handleError(err)
    }
  })

  ipcMain.handle(
    'connections:bulkUpdateCredentials',
    async (_, ids: number[], creds: { username?: string; password?: string }) => {
      try {
        const rows = connection.bulkUpdateCredentials(ids, creds)
        // Mirror each updated row to the backend (per-connection PATCH).
        for (const r of rows) {
          await mirrorConnectionUpdate(r)
        }
        return rows
      } catch (err) {
        handleError(err)
      }
    }
  )

  ipcMain.handle('connections:testAll', (event, ids: number[]) =>
    testAllConnections(ids, event.sender)
  )

  ipcMain.handle('connections:test', (event, id: number) => {
    resetBackoff(id)
    return testConnectionById(id, event.sender)
  })

  ipcMain.handle('connections:delete', async (_, id: number) => {
    await mirrorConnectionDelete(id)
    return connection.delete(id)
  })

  ipcMain.handle('connections:deleteAll', async (_, ids: number[]) => {
    for (const id of ids) await mirrorConnectionDelete(id)
    return connection.deleteAll(ids)
  })
}
