import { ipcMain } from 'electron'
import { groupRepository } from '../db/repositories/group.repository'
import type { CreateGroupDto, UpdateGroupDto } from '@shared/index'

export function registerGroupIpc(): void {
  ipcMain.handle('groups:getAll', () => groupRepository.findAll())

  ipcMain.handle('groups:create', (_, data: CreateGroupDto) => groupRepository.create(data))

  ipcMain.handle('groups:update', (_, id: number, data: UpdateGroupDto) =>
    groupRepository.update(id, data)
  )

  ipcMain.handle('groups:delete', (_, id: number) => groupRepository.delete(id))
}
