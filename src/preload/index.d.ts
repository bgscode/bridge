import { ElectronAPI } from '@electron-toolkit/preload'
import type { ConnectionRow, GroupRow, StoreRow, FiscalYearRow } from '@shared/index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
      }
      connections: {
        getAll: () => Promise<ConnectionRow[]>
        create: (data: unknown) => Promise<ConnectionRow>
        update: (id: number, data: unknown) => Promise<ConnectionRow | undefined>
        delete: (id: number) => Promise<boolean>
      }
      groups: {
        getAll: () => Promise<GroupRow[]>
        create: (data: unknown) => Promise<GroupRow>
        update: (id: number, data: unknown) => Promise<GroupRow | undefined>
        delete: (id: number) => Promise<boolean>
      }
      stores: {
        getAll: () => Promise<StoreRow[]>
        create: (data: unknown) => Promise<StoreRow>
        update: (id: number, data: unknown) => Promise<StoreRow | undefined>
        delete: (id: number) => Promise<boolean>
      }
      fiscalYears: {
        getAll: () => Promise<FiscalYearRow[]>
        create: (data: unknown) => Promise<FiscalYearRow>
        update: (id: number, data: unknown) => Promise<FiscalYearRow | undefined>
        delete: (id: number) => Promise<boolean>
      }
    }
  }
}
