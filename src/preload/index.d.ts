import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ConnectionRow,
  GroupRow,
  JobGroupRow,
  StoreRow,
  FiscalYearRow,
  AppSettings,
  JobRow,
  JobProgress,
  CreateJobDto,
  JobRunOptions,
  CombineCsvFolderOptions,
  CombineCsvFolderResult
} from '@shared/index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
        isFullscreen: () => Promise<boolean>
        onFullscreenChange: (cb: (isFullscreen: boolean) => void) => void
        offFullscreenChange: () => void
        platform: string
      }
      dialog: {
        openFile: (opts?: {
          title?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
        openFolder: (opts?: { title?: string }) => Promise<string | null>
      }
      shell: {
        openPath: (filePath: string) => Promise<string>
        showItemInFolder: (filePath: string) => void
      }
      connections: {
        getAll: () => Promise<ConnectionRow[]>
        create: (data: unknown) => Promise<ConnectionRow>
        bulkCreate: (items: unknown[]) => Promise<ConnectionRow[]>
        update: (id: number, data: unknown) => Promise<ConnectionRow | undefined>
        bulkUpdateCredentials: (
          ids: number[],
          creds: { username?: string; password?: string }
        ) => Promise<ConnectionRow[]>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
        test: (id: number) => Promise<void>
        testAll: (ids: number[]) => Promise<void>
        onTestProgress: (cb: (data: { id: number; status: string; error: string | null }) => void) => void // prettier-ignore
        offTestProgress: () => void
      }
      jobs: {
        getAll: () => Promise<JobRow[]>
        create: (data: CreateJobDto) => Promise<JobRow>
        bulkCreate: (items: CreateJobDto[]) => Promise<JobRow[]>
        update: (id: number, data: unknown) => Promise<JobRow | undefined>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
        run: (id: number, options?: JobRunOptions) => Promise<JobProgress>
        cancel: (id: number) => Promise<boolean>
        isRunning: (id: number) => Promise<boolean>
        getRunning: () => Promise<JobProgress[]>
        schedulerStatus: () => Promise<
          { jobId: number; nextRunAt: string | null; runCount: number }[]
        >
        reschedule: (id: number) => Promise<boolean>
        onProgress: (cb: (data: JobProgress) => void) => void
        offProgress: () => void
        stageUpload: (
          jobId: number | null,
          srcPath: string
        ) => Promise<{ uploadId: string; stagedPath: string; filename: string }>
        stageUploadBuffer: (
          jobId: number | null,
          filename: string,
          buffer: Uint8Array
        ) => Promise<{ uploadId: string; stagedPath: string; filename: string }>
        cleanupStaged: (stagedPath: string) => Promise<boolean>
        previewStagedFile: (
          stagedPath: string,
          sheetName?: string,
          sampleRows?: number
        ) => Promise<{
          fileType: 'csv' | 'xlsx'
          headers: string[]
          sampleRows: Record<string, unknown>[]
          totalSampledRows: number
          sheetNames?: string[]
          activeSheet?: string
        }>
      }
      groups: {
        getAll: () => Promise<GroupRow[]>
        create: (data: unknown) => Promise<GroupRow>
        bulkCreate: (items: unknown[]) => Promise<GroupRow[]>
        update: (id: number, data: unknown) => Promise<GroupRow | undefined>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
      }
      jobGroups: {
        getAll: () => Promise<JobGroupRow[]>
        create: (data: unknown) => Promise<JobGroupRow>
        bulkCreate: (items: unknown[]) => Promise<JobGroupRow[]>
        update: (id: number, data: unknown) => Promise<JobGroupRow | undefined>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
      }
      stores: {
        getAll: () => Promise<StoreRow[]>
        create: (data: unknown) => Promise<StoreRow>
        bulkCreate: (items: unknown[]) => Promise<StoreRow[]>
        update: (id: number, data: unknown) => Promise<StoreRow | undefined>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
      }
      fiscalYears: {
        getAll: () => Promise<FiscalYearRow[]>
        create: (data: unknown) => Promise<FiscalYearRow>
        bulkCreate: (items: unknown[]) => Promise<FiscalYearRow[]>
        update: (id: number, data: unknown) => Promise<FiscalYearRow | undefined>
        delete: (id: number) => Promise<boolean>
        deleteAll: (ids: number[]) => Promise<void>
      }
      settings: {
        getAll: () => Promise<AppSettings>
        setMany: (data: Partial<AppSettings>) => Promise<AppSettings>
      }
      combiner: {
        combine: (options: CombineCsvFolderOptions) => Promise<CombineCsvFolderResult>
      }
      sync: {
        run: (token: string) => Promise<{
          pushed: Record<string, number>
          pulled: Record<string, number>
        }>
        pushOnce: (token: string) => Promise<{
          pushed: Record<string, number>
          pulled: Record<string, number>
        }>
        onCompleted: (
          cb: (result: { pushed: Record<string, number>; pulled: Record<string, number> }) => void
        ) => () => void
      }
      auth: {
        setContext: (token: string | null, role: string | null) => Promise<void>
      }
    }
  }
}
