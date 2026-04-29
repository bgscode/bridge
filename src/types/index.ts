// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// Ek jagah sab types — main process, preload, aur renderer sab yahan se import
// ─────────────────────────────────────────────────────────────────────────────

// ─── Group ───────────────────────────────────────────────────────────────────

export interface GroupRow {
  id: number
  name: string
  description: string | null
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateGroupDto = Pick<GroupRow, 'name' | 'description'>
export type UpdateGroupDto = Partial<CreateGroupDto>

// ─── Job Group ───────────────────────────────────────────────────────────────

export interface JobGroupRow {
  id: number
  name: string
  description: string | null
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateJobGroupDto = Pick<JobGroupRow, 'name' | 'description'>
export type UpdateJobGroupDto = Partial<CreateJobGroupDto>

// ─── Store ───────────────────────────────────────────────────────────────────

export interface StoreRow {
  id: number
  name: string
  code: string
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateStoreDto = Pick<StoreRow, 'name' | 'code'>
export type UpdateStoreDto = Partial<CreateStoreDto>

// ─── Fiscal Year ─────────────────────────────────────────────────────────────

export interface FiscalYearRow {
  id: number
  name: string
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateFiscalYearDto = Pick<FiscalYearRow, 'name'>
export type UpdateFiscalYearDto = Partial<CreateFiscalYearDto>

// ─── Settings ────────────────────────────────────────────────────────────────

export interface SettingRow {
  key: string
  value: string
}

export interface AppSettings {
  monitor_enabled: boolean
  monitor_online_interval: number
  monitor_offline_base: number
  monitor_backoff_max: number
  monitor_workers: number
  monitor_connection_timeout: number
  monitor_startup_test: boolean
  job_concurrent_connections: number
  job_query_timeout: number
  job_max_retries: number
  /**
   * Threshold of rows per Excel sheet. When a single connection / query
   * produces more rows than this threshold, a new continuation sheet is
   * created (named `{sheet}_2`, `{sheet}_3`, …). Default 800_000
   * ≈ 80% of Excel's 1,048,576 row limit.
   */
  excel_sheet_row_threshold: number
  /**
   * How sheet / CSV file names are derived for each connection.
   *   - `connection_name` → use ConnectionRow.name (default)
   *   - `store_name`      → use linked Store.name, fall back to connection name
   *   - `store_code`      → use linked Store.code, fall back to connection name
   */
  excel_sheet_name_source: 'connection_name' | 'store_name' | 'store_code'
  /**
   * When true, create an empty sheet for connections that returned no rows
   * so the workbook has a consistent structure across all selected
   * connections. When false, empty buckets are skipped.
   */
  excel_create_empty_sheets: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  monitor_enabled: true,
  monitor_online_interval: 300,
  monitor_offline_base: 60,
  monitor_backoff_max: 1800,
  monitor_workers: 10,
  monitor_connection_timeout: 15,
  monitor_startup_test: true,
  job_concurrent_connections: 5,
  job_query_timeout: 30,
  job_max_retries: 0,
  excel_sheet_row_threshold: 800000,
  excel_sheet_name_source: 'store_code',
  excel_create_empty_sheets: true
}

// ─── Connection ──────────────────────────────────────────────────────────────

export interface ConnectionRow {
  id: number
  name: string
  group_id: number | null
  static_ip: string
  vpn_ip: string
  db_name: string
  username: string
  password: string
  trust_cert: number
  fiscal_year_id: number | null
  store_id: number | null
  status: 'online' | 'offline' | 'failed' | 'unknown'
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateConnectionDto = Omit<
  ConnectionRow,
  'id' | 'remote_id' | 'created_at' | 'updated_at'
>
export type UpdateConnectionDto = Partial<
  Omit<ConnectionRow, 'id' | 'remote_id' | 'created_at' | 'updated_at'>
>

// ─── Job ─────────────────────────────────────────────────────────────────────

export interface JobRow {
  id: number
  name: string
  description: string | null
  job_group_id: number | null
  /** Repository parses DB JSON text → number[] at runtime */
  connection_ids: number[]
  online_only: boolean
  is_multi: boolean
  type: 'query' | 'action'
  sql_query: string[]
  sql_query_names?: string[]
  // query-type only
  destination_type: 'api' | 'google_sheets' | 'excel' | null
  destination_config: string | null // FK → JSON string
  operation: 'append' | 'replace' | null
  // action-type only
  notify_webhook: string | null
  // Excel template support (query-type, destination_type='excel')
  /** Absolute path to a .xlsx template file (optional). */
  template_path: string | null
  /**
   * - 'new'      → copy the template for each output Excel file, then append data sheets.
   * - 'existing' → open the template in-place and write data sheets into it.
   * - null       → no template; behaves like current plain Excel output.
   */
  template_mode: 'new' | 'existing' | null
  // schedule — JSON string, see ScheduleConfig
  schedule: string | null
  // runtime state
  status: 'idle' | 'running' | 'success' | 'failed'
  last_run_at: string | null
  last_error: string | null
  remote_id?: string | null
  created_at: string
  updated_at: string
}

export type CreateJobDto = Omit<
  JobRow,
  'id' | 'status' | 'last_run_at' | 'last_error' | 'created_at' | 'updated_at'
>
export type UpdateJobDto = Partial<CreateJobDto>

// ─── Job Execution Progress ──────────────────────────────────────────────────

export interface JobConnectionProgress {
  connection_id: number
  connection_name: string
  status: 'pending' | 'connecting' | 'querying' | 'done' | 'error'
  rows: number
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface JobProgress {
  job_id: number
  job_name: string
  status: 'running' | 'success' | 'failed' | 'cancelled'
  total_connections: number
  completed_connections: number
  failed_connections: number
  total_rows: number
  started_at: string
  finished_at: string | null
  connections: JobConnectionProgress[]
  error: string | null
  output_path: string | null
  /** Live adaptive-engine state, updated every few seconds during execution */
  adaptive?: JobAdaptiveState | null
}

export interface JobAdaptiveState {
  /** 0..1 — 1 = idle/healthy */
  health_score: number
  /** 0..1 */
  cpu: number
  /** 0..1 */
  memory: number
  /** event loop lag in ms */
  lag_ms: number
  /** rolling rows/sec */
  throughput: number
  /** true while pressure is forcing a pause */
  backpressure: boolean
  /** short human description */
  reason: string
  /** current concurrent worker count */
  active_workers: number
  /** what the brain is recommending right now */
  target_workers: number
  /** chosen output format */
  output_format: 'excel' | 'excel-stream' | 'csv' | null
  /** reason the format was chosen */
  output_reason: string | null
}

// ─── Job Run ─────────────────────────────────────────────────────────────────

export interface JobRunRow {
  id: number
  job_id: number
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at: string | null
  rows_processed: number
  error: string | null
  /** Repository parses DB JSON text → number[] — connections that errored this run */
  failed_connection_ids: number[]
}

export type CreateJobRunDto = Omit<
  JobRunRow,
  'id' | 'started_at' | 'finished_at' | 'rows_processed'
>
export type UpdateJobRunDto = Partial<Omit<JobRunRow, 'id' | 'job_id' | 'started_at'>>

// Typed config payloads — parse from DestinationConfigRow.config JSON
export interface ApiDestinationConfig {
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers: Record<string, string>
  batch_size: number // rows per HTTP request
}

export interface GoogleSheetsDestinationConfig {
  spreadsheet_id: string
  sheet_name: string
  credentials_json: string // service-account JSON as string
}

export interface ExcelDestinationConfig {
  file_path: string // absolute path to .xlsx file
  sheet_name: string
}

export type DestinationConfig =
  | ApiDestinationConfig
  | GoogleSheetsDestinationConfig
  | ExcelDestinationConfig

// ─── Job Run Options ─────────────────────────────────────────────────────────
// Per-invocation overrides the UI can pass when starting a run. Every field is
// optional; any field left undefined falls back to the persisted JobRow value.

export interface JobRunOptions {
  /** Override JobRow.online_only for this run only. */
  online_only?: boolean
  /**
   * If set, only these connection IDs will be processed during this run.
   * Used by the "Retry failed connections" flow so users can re-run just the
   * subset that errored without redoing successful ones.
   */
  connection_ids?: number[]
}

// ─── Combiner ────────────────────────────────────────────────────────────────

export interface CombineCsvFolderOptions {
  /** Absolute path to folder containing *.csv files. */
  folder: string
  /**
   * Output target. If omitted, writes `<folder>/<folderName>.xlsx`.
   * If a directory, writes `<dir>/<folderName>.xlsx`.
   * If an `.xlsx` path, writes to that file.
   */
  output_path?: string | null
  /** Optional .xlsx template. If provided, template_mode is required. */
  template_path?: string | null
  template_mode?: 'new' | 'existing' | null
  /** Write mode when template_mode === 'existing'. Defaults to 'replace'. */
  operation?: 'append' | 'replace' | null
  /**
   * Max rows per sheet before rolling over to a continuation sheet.
   * Defaults to 800_000 (≈80% of Excel's 1,048,576 hard cap).
   */
  row_threshold?: number | null
}

export interface CombineCsvFolderResult {
  output_paths: string[]
  sheet_count: number
  total_rows: number
  skipped_files: string[]
}
