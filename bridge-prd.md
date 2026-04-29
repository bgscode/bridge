# Bridge App — Complete PRD

## 1. App Overview

**Bridge** is an Electron desktop application that connects to multiple SQL Server databases, runs scheduled queries, and sends data to various destinations (Google Sheets, Webhooks, APIs, Excel, CSV). It manages connections, jobs, scheduling, and real-time monitoring — all from a clean modern UI.

**Target:** Windows, macOS, Linux
**Stack:** Electron + electron-vite + React + TypeScript + SQLite (better-sqlite3) + shadcn/ui + Tailwind CSS

---

## 2. Current State (What's Done)

### 2.1 Database Schema (SQLite)
- `groups` — id, name, description, created_at, updated_at
- `stores` — id, name, code, created_at, updated_at
- `fiscal_years` — id, name, created_at, updated_at
- `connections` — id, name, group_id (FK→groups), static_ip, vpn_ip, db_name, username, password, trust_cert, fiscal_year_id (FK→fiscal_years), store_id (FK→stores), status, created_at, updated_at
- `migrations` — version tracking

### 2.2 Main Process
- `src/main/db/` — SQLite setup, migrations, repositories (connection, group, store, fiscal-year)
- `src/main/ipc/` — IPC handlers for each entity
- `src/main/window/` — Window management

### 2.3 Preload Bridge
- `window.api.connections` — getAll, create, bulkCreate, update, delete, deleteAll
- `window.api.groups` — same CRUD
- `window.api.stores` — same CRUD
- `window.api.fiscalYears` — same CRUD
- `window.api.window` — minimize, maximize, close, isMaximized

### 2.4 Renderer
- React Context providers (Groups, Stores, FiscalYears, Connections)
- Pages: connection, groups, stores, fiscal-years (all with DataGrid, CRUD, bulk upload, template download, toast notifications)
- Custom DataGrid component with sorting, filtering, pagination, column management, CSV/Excel import/export
- shadcn/ui components
- Sidebar navigation

### 2.5 Placeholder Pages (exist but empty)
- dashboard, analytics, projects, team, lifecycle, create, datagrid-preview

---

## 3. Phase 1 — Connection Testing (NEXT)

### 3.1 Single Connection Test
**What:** Test one connection by connecting to its SQL Server and running `SELECT 1 AS test`
**How:**
1. Add `mssql` package to main process
2. Create `src/main/services/sql-connector.ts`:
   - `connect(config)` — try static_ip first, if fail try vpn_ip
   - `executeQuery(query)` — run SQL query with timeout
   - `disconnect()` — release connection
   - `testConnection(connection)` — connect → `SELECT 1` → return success/fail + which server (static/vpn)
3. Add IPC handler: `test-connection` (connectionId) → returns `{ success, message, activeServerType }`
4. Update preload: `window.api.connections.test(id)`
5. Update connection context: add `test(id)` method
6. Update UI: "Test" button in row actions → shows loading → updates status badge
7. Update connection row: set `status` to 'online'/'failed', save to DB

**Connection Config for mssql:**
```typescript
{
  server: connection.static_ip, // or vpn_ip as fallback
  database: connection.db_name,
  user: connection.username,
  password: connection.password,
  port: 1433, // default
  options: {
    trustServerCertificate: !!connection.trust_cert,
    encrypt: false,
    connectTimeout: 15000, // 15 seconds
    requestTimeout: 30000, // 30 seconds
  }
}
```

**VPN Fallback Logic:**
1. Try static_ip first
2. If fails and vpn_ip exists → try vpn_ip
3. Return which one connected (static/vpn)

### 3.2 Bulk Connection Test
**What:** Test multiple/all connections in parallel
**How:**
1. IPC handler: `bulk-test-connections` (ids[]) → test all in parallel with Promise.allSettled + per-connection timeout
2. Preload: `window.api.connections.bulkTest(ids)`
3. UI: "Test All" button in toolbar → progress indicator → updates all status badges
4. Concurrency limit: max 5 parallel (configurable)
5. Timeout: 30 seconds per connection (configurable)

### 3.3 Status Badge Component
Already exists as `<StatusBadge status={...} />`. After test:
- `online` → green badge
- `failed` → red badge
- `offline` → gray badge
- `unknown` → yellow badge

---

## 4. Phase 2 — Jobs Engine

### 4.1 Database Schema (New Tables)

```sql
-- Migration v3
CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  enabled         INTEGER DEFAULT 1,
  query           TEXT    NOT NULL,
  schedule_type   TEXT    DEFAULT 'cron',  -- 'cron' | 'interval' | 'once' | 'daily' | 'every-n-days'
  schedule_value  TEXT,                     -- cron expression or interval like '5m'
  time_of_day     TEXT,                     -- HH:MM for daily/every-n-days
  every_n_days    INTEGER,                  -- for every-n-days type
  trigger_mode    TEXT    DEFAULT 'always', -- 'always' | 'onChange'
  group_name      TEXT,                     -- job group (category label)
  last_run        TEXT,
  last_hash       TEXT,                     -- for onChange trigger (hash of last result)
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

-- Many-to-many: job ↔ connections
CREATE TABLE job_connections (
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, connection_id)
);

-- Multi-query support
CREATE TABLE job_queries (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name    TEXT    NOT NULL,
  query   TEXT    NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Destinations per job
CREATE TABLE job_destinations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type    TEXT    NOT NULL,  -- 'webhook' | 'google_sheets' | 'custom_api' | 'excel' | 'csv'
  config  TEXT    NOT NULL   -- JSON blob with destination-specific config
);

-- Job execution history
CREATE TABLE job_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_name              TEXT    NOT NULL,
  status                TEXT    NOT NULL,  -- 'completed' | 'failed' | 'running' | 'cancelled'
  started_at            TEXT    NOT NULL,
  completed_at          TEXT,
  duration_ms           INTEGER,
  total_connections     INTEGER DEFAULT 0,
  completed_connections INTEGER DEFAULT 0,
  failed_connections    INTEGER DEFAULT 0,
  errors                TEXT,  -- JSON array of error strings
  result                TEXT,  -- JSON blob
  created_at            TEXT DEFAULT (datetime('now'))
);
```

### 4.2 Types (add to src/types/index.ts)

```typescript
// ─── Job ─────────────────────────────────────────────────────────────────────
export interface JobRow {
  id: number
  name: string
  enabled: number  // 0 or 1
  query: string
  schedule_type: 'cron' | 'interval' | 'once' | 'daily' | 'every-n-days'
  schedule_value: string | null
  time_of_day: string | null
  every_n_days: number | null
  trigger_mode: 'always' | 'onChange'
  group_name: string | null
  last_run: string | null
  last_hash: string | null
  created_at: string
  updated_at: string
}

export interface JobConnectionRow {
  job_id: number
  connection_id: number
}

export interface JobQueryRow {
  id: number
  job_id: number
  name: string
  query: string
  sort_order: number
}

export interface JobDestinationRow {
  id: number
  job_id: number
  type: 'webhook' | 'google_sheets' | 'custom_api' | 'excel' | 'csv'
  config: string  // JSON
}

export interface JobHistoryRow {
  id: number
  job_id: number
  job_name: string
  status: 'completed' | 'failed' | 'running' | 'cancelled'
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  total_connections: number
  completed_connections: number
  failed_connections: number
  errors: string | null     // JSON array
  result: string | null     // JSON blob
  created_at: string
}

// ─── Destination Configs (typed JSON) ─────────────────────────────────────────

export interface WebhookDestinationConfig {
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  batchSize?: number
}

export interface GoogleSheetsDestinationConfig {
  spreadsheetId: string
  sheetName: string
  mode: 'append' | 'replace' | 'update'
  keyColumn?: string
  credentialsJson: string  // pasted JSON credentials
}

export interface CustomAPIDestinationConfig {
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  batchSize?: number
}

export interface ExcelDestinationConfig {
  filePath: string
  sheetName?: string
  mode: 'append' | 'replace'
}

export interface CSVDestinationConfig {
  filePath: string
  mode: 'append' | 'replace'
  delimiter?: string           // default ','
  includeHeaders?: boolean     // default true
}

// ─── Create/Update DTOs ──────────────────────────────────────────────────────

export interface CreateJobDto {
  name: string
  enabled?: boolean
  query: string
  schedule_type: JobRow['schedule_type']
  schedule_value?: string
  time_of_day?: string
  every_n_days?: number
  trigger_mode: 'always' | 'onChange'
  group_name?: string
  connectionIds: number[]
  queries?: { name: string; query: string; sort_order?: number }[]
  destinations: { type: JobDestinationRow['type']; config: string }[]
}
```

### 4.3 Repository Layer
Create `src/main/db/repositories/job.repository.ts`:
- `getAll()` — returns jobs with connectionIds, queries, destinations joined
- `getById(id)` — single job with full relations
- `create(dto)` — insert job + job_connections + job_queries + job_destinations (transaction)
- `update(id, dto)` — update job + replace relations (transaction)
- `delete(id)` — cascade delete
- `deleteAll(ids)` — bulk delete

### 4.4 IPC Handlers
Create `src/main/ipc/job.ipc.ts`:
- `jobs:getAll`, `jobs:create`, `jobs:update`, `jobs:delete`, `jobs:deleteAll`
- `jobs:run` — run job immediately
- `jobs:test` — test job (run query on first connection, return row count)
- `jobs:toggle` — enable/disable

### 4.5 Preload
Add `window.api.jobs`:
- getAll, create, update, delete, deleteAll, run, test, toggle

### 4.6 Renderer — Jobs Page
- DataGrid listing all jobs
- Columns: name, enabled (toggle), schedule, trigger, connections count, last run, status, actions
- Create/Edit form (sheet/dialog):
  - Name, Group
  - Query editor (textarea with monospace font)
  - Multi-query support (add/remove query tabs)
  - Schedule type selector (cron, interval, daily, every-n-days, manual)
  - Schedule value input (context-dependent)
  - Trigger mode (always / onChange)
  - Connection picker (multi-select from connections list)
  - Destinations (add/remove, each with type + config form)
- Run Now button
- Test Query button (runs query, shows row count)
- Duplicate, Delete, Bulk Delete
- Job enable/disable toggle

---

## 5. Phase 3 — Scheduler Service

### 5.1 Scheduler (`src/main/services/scheduler.ts`)
- Uses `node-cron` for scheduling
- On app start: load all enabled jobs, schedule each
- `scheduleJob(job)` — parse schedule_type + time_of_day + every_n_days → cron expression → schedule
- `stopJob(jobId)` — stop cron task
- `rescheduleAll()` — stop all, reload, start all
- `runJobNow(jobId)` — execute immediately

**Schedule Parsing:**
| Type | Input | Cron Output |
|---|---|---|
| `cron` | `*/5 * * * *` | as-is |
| `interval` | `5m` | `*/5 * * * *` |
| `daily` | timeOfDay: `09:30` | `30 9 * * *` |
| `every-n-days` | everyNDays: 3, timeOfDay: `14:00` | `0 14 */3 * *` |
| `once` | — | no scheduling, run manually only |

### 5.2 Executor (`src/main/services/executor.ts`)
- `executeJob(job, connections[])` — for each connection:
  1. Connect to SQL Server (static_ip, fallback vpn_ip)
  2. Execute query (or multiple queries if job_queries exist)
  3. Collect results with connection metadata
  4. Check trigger (onChange: hash results, compare with last_hash)
  5. Send to each destination via adapter
  6. Update job.last_run, job.last_hash
  7. Record to job_history

### 5.3 Progress Tracking
- `src/main/services/progress-stream.ts`
- EventEmitter-based: emits progress events per job per connection
- IPC events to renderer: `job:progress`, `job:finished`, `job:failed`
- Track per-connection: connecting → executing → processing → sending → done/failed
- Support cancellation: `cancel-job` IPC → set cancellation flag → executor checks before each step

---

## 6. Phase 4 — Destination Adapters

### 6.1 Adapter Interface
```typescript
export interface DestinationAdapter {
  name: string
  send(data: any[], config: any, meta: JobMeta): Promise<SendResult>
  sendMultiConnection?(dataWithMeta: Array<{connection: any; data: any[]}>, config: any, meta: any): Promise<SendResult>
}
```

### 6.2 Webhook Adapter (`src/main/adapters/webhook.ts`)
- POST/PUT/PATCH to URL
- Custom headers
- Batch sending (split data into batchSize chunks)
- sends JSON payload: `{ jobId, jobName, connectionName, data, rowCount, timestamp }`

### 6.3 Google Sheets Adapter (`src/main/adapters/google-sheets.ts`)
- Uses `googleapis` package
- Auth via service account JSON (pasted in config, not file path)
- Modes: append (add rows), replace (clear sheet + write), update (match by key column)
- Multi-connection: each connection can write to separate sheet (named by connection/database/store)
- Sheet name format configurable: connectionName | databaseName | storeName

### 6.4 Excel Adapter (`src/main/adapters/excel.ts`)
- Uses `exceljs` package
- Write to .xlsx file
- Modes: replace (overwrite), append (add rows to existing)
- Multi-connection: each connection gets its own sheet tab
- Progressive write: write per-connection as data comes (to avoid memory overflow)

### 6.5 CSV Adapter (`src/main/adapters/csv.ts`)
- Simple file write
- Custom delimiter (comma, semicolon, tab)
- Modes: replace, append
- Include/exclude headers option

### 6.6 Custom API Adapter (`src/main/adapters/custom-api.ts`)
- Same as webhook but for generic REST APIs
- Custom headers, batch size
- POST/PUT/PATCH

### 6.7 Adapter Registry (`src/main/adapters/index.ts`)
- Map of adapter name → adapter instance
- `getAdapter(type)`, `registerAdapter(adapter)`, `listAdapters()`

---

## 7. Phase 5 — Additional Entity Pages

### 7.1 Partners Page
**Schema:**
```sql
CREATE TABLE partners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);
```
**Features:** Same CRUD pattern as groups (DataGrid + form + bulk upload + template)

### 7.2 System Users Page
**Schema:**
```sql
CREATE TABLE system_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  number      TEXT    NOT NULL UNIQUE,
  group_name  TEXT,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);
```
**Features:** CRUD + bulk upload. Used for WhatsApp notification recipients.

### 7.3 WhatsApp Groups Page
**Schema:**
```sql
CREATE TABLE whatsapp_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  group_id    TEXT    NOT NULL UNIQUE,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);
```
**Features:** CRUD + bulk upload. Used for WhatsApp group notifications.

---

## 8. Phase 6 — Monitoring & Dashboard

### 8.1 Job Monitor Page
- Real-time job execution view
- Per-job: status, progress bar, current connection, rows processed
- Per-connection within job: status (waiting → running → done/failed)
- Cancel button for running jobs
- Auto-refresh

### 8.2 Job History Page
- DataGrid of all past executions
- Columns: job name, status, started, duration, connections (passed/failed), actions
- Retry failed connections button
- Clear history, Delete history entries
- Filter by job, date range, status

### 8.3 Logs Page
- Real-time log viewer
- Levels: info, warn, error
- Filter by level, job, search text
- Clear logs button
- Auto-scroll to bottom

### 8.4 Dashboard Page (replace placeholder)
- Total connections (online/offline/failed counts)
- Total jobs (enabled/disabled)
- Recent job executions (last 10) with status
- Connection health overview (pie chart or bar)
- Quick actions: Run all jobs, Test all connections

---

## 9. Phase 7 — Settings & System

### 9.1 Settings Page
**Schema:**
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Settings:**
| Key | Type | Default | Description |
|---|---|---|---|
| `db_pool_max` | number | 10 | Max SQL connection pool size |
| `default_connection_timeout` | number | 30 | Connection timeout (seconds) |
| `default_query_timeout` | number | 300 | Query timeout (seconds) |
| `max_concurrent_connections` | number | 50 | Max parallel connections |
| `job_queue_max_concurrent` | number | 3 | Max concurrent job executions |
| `sheet_name_format` | string | 'connectionName' | 'connectionName' / 'databaseName' / 'storeName' |
| `connection_test_enabled` | boolean | false | Auto-test connections on schedule |
| `connection_test_cron` | string | '0 */2 * * *' | Cron for auto connection testing |
| `connection_test_send_to` | string | 'number' | 'number' / 'groups' |
| `connection_test_show_failed` | boolean | true | Show failed in notification |
| `connection_test_show_passed` | boolean | false | Show passed in notification |

### 9.2 System Tray
- Minimize to tray (don't quit on window close)
- Tray icon with context menu: Show, Hide, Quit, Force Quit
- Balloon/notification on minimize
- Double-click tray icon → show/hide window
- Tray tooltip shows running status

### 9.3 Connection Pool Manager (`src/main/services/connection-pool.ts`)
- Reuse mssql ConnectionPool instances
- Key by server:port:database
- Auto-close idle pools after timeout
- `acquire(config)` → return existing or create new pool
- `release(config)` → mark pool as available, close after idle timeout
- Metrics: active pools, total connections, pool hit rate

### 9.4 Job Queue (`src/main/services/job-queue.ts`)
- Concurrency-limited job execution
- Queue jobs when max concurrent reached
- Priority: manual runs > scheduled runs
- Metrics: running count, pending count, completed count

---

## 10. Phase 8 — Advanced Features

### 10.1 Auto Connection Test Scheduler
- Runs on cron schedule (configurable)
- Tests all connections in parallel
- Sends WhatsApp notification with results
- Deduplicates by IP (same static_ip+vpn_ip = test once)

### 10.2 WhatsApp Notifications
- Uses external WhatsApp API (HTTP POST)
- Connection test results notification
- Job failure notifications (future)
- Send to individual numbers or groups

### 10.3 Data Migration (from old SQL Bridge app)
- Check if old app data exists in AppData
- Offer to migrate: config, jobs, connections, history
- Force re-migrate option
- Backup before overwrite

### 10.4 Multi-Query Jobs
- Jobs can have multiple named queries
- Each query runs on each connection
- Results per query per connection
- Destinations receive all query results

### 10.5 onChange Trigger
- Hash query results after each run
- Compare with previous hash (stored in job.last_hash)
- If same → skip sending to destinations
- If different → send and update hash

---

## 11. Old Repo → New Repo Entity Mapping

| Old (JSON/string-based) | New (SQLite) | Status |
|---|---|---|
| `connections[]` in config.json | `connections` table | ✅ Done |
| `settings.jobGroups[]` (strings) | `groups` table (with description) | ✅ Done |
| `settings.stores[]` ({name, shortName}) | `stores` table ({name, code}) | ✅ Done |
| `settings.financialYears[]` (strings) | `fiscal_years` table | ✅ Done |
| `settings.partners[]` (strings) | `partners` table | ❌ Phase 5 |
| `settings.systemUsers[]` ({name, number, group}) | `system_users` table | ❌ Phase 5 |
| `settings.whatsappGroups[]` ({name, groupId}) | `whatsapp_groups` table | ❌ Phase 5 |
| `jobs[]` in config.json | `jobs` + `job_connections` + `job_queries` + `job_destinations` tables | ❌ Phase 2 |
| `jobHistory[]` in job-history.json | `job_history` table | ❌ Phase 2 |
| `settings.*` (flat JSON) | `settings` table (key-value) | ❌ Phase 7 |

---

## 12. Old Repo UI Pages → New Repo Mapping

| Old Page | Purpose | New Equivalent | Status |
|---|---|---|---|
| ConnectionsPage.tsx | CRUD connections | `pages/connection/` | ✅ Done |
| ConnectionsDashboard.tsx | Connection overview | Part of Dashboard | ❌ Phase 6 |
| SingleQueryJobsPage.tsx | Single-query jobs | `pages/jobs/` | ❌ Phase 2 |
| MultiQueryJobsPage.tsx | Multi-query jobs | `pages/jobs/` (unified) | ❌ Phase 2 |
| JobMonitor.tsx | Live job execution | `pages/monitor/` | ❌ Phase 6 |
| LogsPage.tsx | Log viewer | `pages/logs/` | ❌ Phase 6 |
| MonitoringPage.tsx | Pool/queue metrics | `pages/monitoring/` | ❌ Phase 6 |
| SettingsPage.tsx | App settings | `pages/settings/` | ❌ Phase 7 |

---

## 13. NPM Packages Needed (not yet installed)

| Package | Purpose | Phase |
|---|---|---|
| `mssql` | SQL Server connection | Phase 1 |
| `node-cron` | Job scheduling | Phase 3 |
| `googleapis` | Google Sheets API | Phase 4 |
| `exceljs` | Excel file read/write | Phase 4 |
| `axios` | HTTP requests (webhooks, APIs) | Phase 4 |
| `crypto` (built-in) | Hash for onChange trigger | Phase 3 |

---

## 14. Implementation Priority Order

1. **Connection Testing** — test single + bulk test + status update (Phase 1)
2. **Jobs CRUD** — database schema, repository, IPC, page (Phase 2)  
3. **Scheduler** — cron scheduling, executor, run jobs (Phase 3)
4. **Adapters** — webhook, google sheets, excel, csv, custom api (Phase 4)
5. **Additional Entities** — partners, system users, whatsapp groups (Phase 5)
6. **Monitoring** — job monitor, history, logs, dashboard (Phase 6)
7. **Settings & System** — settings page, system tray, pool manager, job queue (Phase 7)
8. **Advanced** — auto test scheduler, whatsapp notifications, migration, onChange trigger (Phase 8)
