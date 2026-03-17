import { ipcMain } from 'electron'
import { connection } from '../db/repositories/connection.repositories'
import type { CreateConnectionDto, UpdateConnectionDto } from '@shared/index'

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:getAll', () => connection.findAll())

  ipcMain.handle('connections:create', (_, data: CreateConnectionDto) => connection.create(data))

  ipcMain.handle('connections:update', (_, id: number, data: UpdateConnectionDto) =>
    connection.update(id, data)
  )

  ipcMain.handle('connections:delete', (_, id: number) => connection.delete(id))
}
