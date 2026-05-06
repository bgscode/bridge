# Bridge — Backend Sync Update Plan

> **App-side changes are already done.** This document is the complete spec for the backend
> developer to implement matching changes so that data stays consistent when any user logs in
> from a new machine.

---

## 🚨 URGENT — Fix Body Size Limit First (currently blocking all pushes)

The `/sync/push` endpoint is returning **HTTP 413 "request entity too large"**.
The push payload contains all jobs, connections, groups, stores, and settings in one JSON body.
With real data this easily exceeds the default 1 MB limit in Express / NestJS.

**Fix — increase the body parser limit to at least 50 MB:**

### Express

```typescript
// In your main app setup (app.ts / main.ts):
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))
```

### NestJS

```typescript
// In main.ts:
import * as bodyParser from 'body-parser'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(bodyParser.json({ limit: '50mb' }))
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))
  await app.listen(3000)
}
```

### If using Fastify

```typescript
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ bodyLimit: 52428800 }) // 50 MB in bytes
)
```

**This is a one-line config change. Deploy it and push will work immediately.**

---

## Quick Summary of What Was Fixed in the App

Three files were changed in the Electron app:

| File                                     | What changed                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/main/services/sync/mirror.ts`       | `buildJobBody()` now sends `modify_dates`, `summary_extra_columns`, `excel_combine_sheets` on every real-time mirror call   |
| `src/main/services/sync/sync.service.ts` | Push mapper now includes all 3 fields; Pull `RemoteJob` type, INSERT, UPDATE, and params all updated to handle all 3 fields |

---

## Architecture Overview

```
Electron App (local SQLite)  ←──────────────→  Your Backend (Postgres/MySQL + REST API)
        │
        ├── Real-time mirror (admin users only)
        │     On every create/update/delete → immediate REST call to server
        │
        └── Full bidirectional sync (on every login)
              PUSH  →  POST /api/sync/push    (local → server, upsert all rows)
              PULL  ←  GET  /api/sync/pull    (server → local, server is master)
```

API base: `https://link.yonolight.com/api`  
Auth: `Authorization: Bearer <jwt_token>` header on every request

---

## 1. Database — Add 3 Columns to the `jobs` Table

Run this migration on your backend database:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS modify_dates       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS summary_extra_columns  JSONB   DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS excel_combine_sheets   BOOLEAN NOT NULL DEFAULT false;
```

> If your DB is MySQL instead of Postgres:
>
> ```sql
> ALTER TABLE jobs ADD COLUMN modify_dates          TINYINT(1) NOT NULL DEFAULT 1;
> ALTER TABLE jobs ADD COLUMN summary_extra_columns  JSON       DEFAULT NULL;
> ALTER TABLE jobs ADD COLUMN excel_combine_sheets   TINYINT(1) NOT NULL DEFAULT 0;
> ```

---

## 2. Job Model / DTO — Accept and Return 3 New Fields

In every place your backend defines a Job schema (Prisma model, TypeORM entity, Zod schema, etc.)
add:

```
modifyDates           Boolean   default: true
summaryExtraColumns   String[]  nullable, default: null   (stored as JSON array)
excelCombineSheets    Boolean   default: false
```

---

## 3. REST Endpoints to Update

### `POST /api/jobs`

Accept in request body (camelCase):

```json
{
  "modifyDates": true,
  "summaryExtraColumns": ["group_name", "store_name"],
  "excelCombineSheets": false
}
```

Save to DB. Return the created job with all fields including these 3.

### `PATCH /api/jobs/:id`

Accept the same 3 fields in the body and update them in DB.

### `GET /api/jobs/:id`

Return these fields in the response:

```json
{
  "modifyDates": true,
  "summaryExtraColumns": null,
  "excelCombineSheets": false
}
```

---

## 4. Sync Push — `POST /api/sync/push`

The app now sends these fields for every job in the `jobs` array of the push payload:

```json
{
  "jobs": [
    {
      "localId": 1,
      "remoteId": "uuid-or-null",
      "name": "Daily Sales",
      "...",
      "modify_dates": true,
      "summary_extra_columns": ["store_name", "fiscal_year_name"],
      "excel_combine_sheets": false
    }
  ]
}
```

> Note: the push payload uses **snake_case** for these fields (matching how other fields like
> `online_only`, `is_multi` are sent). Parse and save them accordingly.

**Server must:**

1. Accept `modify_dates` (boolean), `summary_extra_columns` (string array or null), `excel_combine_sheets` (boolean)
2. Upsert the job row with these values
3. Return the same `{ localId: remoteId }` map as before — no change to response shape

---

## 5. Sync Pull — `GET /api/sync/pull`

The app now expects these fields in every job object returned:

```json
{
  "jobs": [
    {
      "id": "uuid",
      "name": "Daily Sales",
      "...",
      "modifyDates": true,
      "summaryExtraColumns": ["store_name"],
      "excelCombineSheets": false
    }
  ]
}
```

> Note: the pull response uses **camelCase** (matching existing fields like `onlineOnly`, `isMulti`,
> `templatePath`, etc.)

**If the column doesn't exist on the server yet**, return safe defaults:

```json
"modifyDates": true,
"summaryExtraColumns": null,
"excelCombineSheets": false
```

This prevents the app from crashing during the transition period.

---

## 6. All Current Job Fields — Complete Reference

This is the full list the app sends on push and expects on pull, so you can verify nothing is missing:

### Push payload fields (snake_case):

```
localId, remoteId, name, description,
jobGroupLocalId, jobGroupRemoteId,
connectionLocalIds[], connectionRemoteIds[],
online_only, is_multi, type,
sql_query[], sql_query_names[],
destination_type, destination_config, operation, notify_webhook,
template_path, template_mode, schedule, status,
modify_dates,              ← newly added
summary_extra_columns,     ← newly added
excel_combine_sheets       ← newly added
```

### Pull response fields (camelCase):

```
id, name, description, ownerId,
jobGroupId,
connectionIds[],
onlineOnly, isMulti, type,
sqlQuery[], sqlQueryNames,
destinationType, destinationConfig, operation, notifyWebhook,
templatePath, templateMode, schedule, status,
lastRunAt, lastError,
modifyDates,              ← newly needed
summaryExtraColumns,      ← newly needed
excelCombineSheets        ← newly needed
```

---

## 7. Job Variables — Future Work (Not Implemented in App Yet)

The app has a `job_variables` and `job_variable_values` table locally but they are **not yet
synced**. This is a separate, larger feature. Do not implement this yet — it will be specified
separately once the 3 missing job fields above are stable.

---

## 8. Testing Checklist

After deploying the backend changes, verify:

- [ ] Create a job with `modify_dates = false` → login on a second machine → job still has `modify_dates = false`
- [ ] Create a job with `summary_extra_columns = ["group_name", "store_name"]` → re-login → summary columns are still selected
- [ ] Create a job with `excel_combine_sheets = true` → re-login → "Combine into one sheet" toggle is still ON
- [ ] Create a job → edit → run a sync push → run a sync pull → all 3 fields unchanged
- [ ] Check that existing jobs (before this migration) default to `modify_dates=true`, `summary_extra_columns=null`, `excel_combine_sheets=false`

---

## 1. Architecture Overview

```
Electron App (local SQLite)
        │
        ├── Real-time mirror (admin only)
        │     mirror.ts → REST calls on every create/update/delete
        │
        └── Full bidirectional sync (on every login)
              sync.service.ts
              PUSH  →  POST /sync/push   (local → server)
              PULL  ←  GET  /sync/pull   (server → local, server is master)
```

API base: `https://link.yonolight.com/api`

---

## 2. All Local SQLite Tables

| Table                 | Purpose                        | Synced?                       |
| --------------------- | ------------------------------ | ----------------------------- |
| `groups`              | Connection groups              | ✅ Yes                        |
| `stores`              | Store entities                 | ✅ Yes                        |
| `fiscal_years`        | Fiscal year periods            | ✅ Yes                        |
| `job_groups`          | Job groupings                  | ✅ Yes                        |
| `settings`            | App-level settings (13 keys)   | ✅ Yes                        |
| `connections`         | DB connection configs          | ✅ Yes                        |
| `jobs`                | Job definitions                | ⚠️ Partial (3 fields missing) |
| `job_variables`       | Per-job checkpoint variables   | ❌ Not synced                 |
| `job_variable_values` | Per-connection variable values | ❌ Not synced                 |
| `job_runs`            | Run history logs               | ❌ Not synced (intentional)   |
| `migrations`          | Local-only migration tracker   | — (not applicable)            |

---

## 3. Jobs — Missing Fields

### 3a. What gets synced today

The following `jobs` fields are sent on every PUSH and mirrored on every write:

```
name, description, job_group_id, connection_ids, online_only, is_multi,
type, sql_query, sql_query_names, destination_type, destination_config,
operation, notify_webhook, template_path, template_mode, schedule, status
```

### 3b. Fields that exist in SQLite but are NOT synced

| Field                   | Added in migration | Type                  | Effect of not syncing                                                                                 |
| ----------------------- | ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `modify_dates`          | v19                | boolean (INTEGER 0/1) | User on new machine always gets default ON; jobs that should write raw dates will format them instead |
| `summary_extra_columns` | v21                | JSON array or NULL    | Summary sheet extra columns (group, store, FY, IP, etc.) silently disappear on re-login               |
| `excel_combine_sheets`  | v22                | boolean (INTEGER 0/1) | "Combine into one sheet" toggle resets to OFF on re-login                                             |

---

## 4. Job Variables — Completely Missing

`job_variables` and `job_variable_values` are **never pushed, pulled, or mirrored**.

**Impact:** Incremental sync jobs using `{{variable}}` checkpoints lose all saved values when
the user logs in on a different machine. The job runs from scratch instead of from the last
processed value.

### Schema that needs to be created on the server

```sql
-- job_variables
id           UUID / serial PK
job_id       FK → jobs(id)  ON DELETE CASCADE
name         TEXT NOT NULL
description  TEXT
default_value TEXT
auto_update  BOOLEAN DEFAULT false
source_column TEXT
update_fn    TEXT DEFAULT 'max'  -- 'max' | 'min' | 'last'
created_at   TIMESTAMP
updated_at   TIMESTAMP
UNIQUE(job_id, name)

-- job_variable_values
id                INTEGER PK
job_variable_id   FK → job_variables(id)  ON DELETE CASCADE
connection_id     TEXT  -- remote_id of the connection (not FK, intentional)
value             TEXT
last_run_at       TIMESTAMP
updated_at        TIMESTAMP
UNIQUE(job_variable_id, connection_id)
```

---

## 5. Required Backend API Changes

### 5a. Job model — add 3 fields

Every job endpoint that creates or returns a job must include:

| JSON field            | Type               | Notes                     |
| --------------------- | ------------------ | ------------------------- |
| `modifyDates`         | boolean            | default `true`            |
| `summaryExtraColumns` | `string[] \| null` | JSON array of column keys |
| `excelCombineSheets`  | boolean            | default `false`           |

**Endpoints to update:**

- `POST   /jobs` — accept these fields in request body
- `PATCH  /jobs/:id` — accept these fields in request body
- `GET    /jobs/:id` — return these fields
- `GET    /sync/pull` — return these fields in each job object
- `POST   /sync/push` — accept these fields in each job object

---

### 5b. New endpoints for job variables

```
GET    /job-variables?jobId=<remote_job_id>
       → returns all variables for that job with their values array

POST   /job-variables
       body: { jobId, name, description, defaultValue, autoUpdate, sourceColumn, updateFn }
       → creates variable, returns { id, ... }

PATCH  /job-variables/:id
       body: partial variable fields
       → updates variable

DELETE /job-variables/:id
       → deletes variable and all its values

POST   /job-variables/:id/values
       body: { connectionId, value, lastRunAt }
       → upsert a checkpoint value for a specific connection

DELETE /job-variables/by-job/:jobId/by-connection/:connectionId
       → clear all variable values for that connection in that job
```

---

### 5c. Sync push — add job variables to payload

The `POST /sync/push` payload currently has this shape:

```json
{
  "stores": [...],
  "fiscalYears": [...],
  "groups": [...],
  "jobGroups": [...],
  "settings": [...],
  "connections": [...],
  "jobs": [...]
}
```

**Add a new `jobVariables` array:**

```json
{
  ...existing fields...,
  "jobVariables": [
    {
      "localId": 1,
      "remoteId": "uuid-or-null",
      "jobLocalId": 5,
      "jobRemoteId": "uuid",
      "name": "last_date",
      "description": "Last processed date",
      "defaultValue": "2024-01-01",
      "autoUpdate": true,
      "sourceColumn": "order_date",
      "updateFn": "max",
      "values": [
        {
          "connectionRemoteId": "conn-uuid",
          "value": "2024-06-15",
          "lastRunAt": "2024-06-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

**Server response should include:**

```json
{
  ...existing maps...,
  "jobVariables": { "<localId>": "<remoteId>", ... }
}
```

---

### 5d. Sync pull — add job variables to response

The `GET /sync/pull` response currently returns:

```json
{
  "stores": [...],
  "fiscalYears": [...],
  "groups": [...],
  "jobGroups": [...],
  "settings": [...],
  "connections": [...],
  "jobs": [...]
}
```

**Add `jobVariables` array:**

```json
{
  ...existing fields...,
  "jobVariables": [
    {
      "id": "uuid",
      "jobId": "job-uuid",
      "name": "last_date",
      "description": "...",
      "defaultValue": "2024-01-01",
      "autoUpdate": true,
      "sourceColumn": "order_date",
      "updateFn": "max",
      "values": [
        {
          "connectionId": "conn-uuid",
          "value": "2024-06-15",
          "lastRunAt": "2024-06-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

---

## 6. Required App-Side Changes

### 6a. `src/main/services/sync/mirror.ts` — `buildJobBody()`

Add the 3 missing fields:

```typescript
// Current buildJobBody — missing these 3 lines:
modify_dates: row.modify_dates !== false,
summary_extra_columns: row.summary_extra_columns ?? null,
excel_combine_sheets: !!row.excel_combine_sheets,
```

Also add mirror functions for job variables:

```typescript
export async function mirrorJobVariableCreate(
  variable: JobVariable,
  jobRemoteId: string
): Promise<void>
export async function mirrorJobVariableUpdate(
  variable: JobVariable,
  jobRemoteId: string
): Promise<void>
export async function mirrorJobVariableDelete(localId: number): Promise<void>
export async function mirrorJobVariableSetValue(
  jobVariableRemoteId: string,
  connectionRemoteId: string,
  value: string,
  lastRunAt: string
): Promise<void>
```

---

### 6b. `src/main/services/sync/sync.service.ts` — PUSH

In the jobs mapper (around line 171), add:

```typescript
modify_dates: Boolean(r.modify_dates),
summary_extra_columns: (() => {
  try { return JSON.parse((r.summary_extra_columns as string) ?? 'null') } catch { return null }
})(),
excel_combine_sheets: Boolean(r.excel_combine_sheets),
```

Add job variables to the push payload:

```typescript
const jobVariables = db.prepare('SELECT * FROM job_variables').all() as Row[]
const jobVariableValues = db.prepare('SELECT * FROM job_variable_values').all() as Row[]

// In payload:
jobVariables: jobVariables.map((v) => ({
  localId: v.id,
  remoteId: v.remote_id ?? undefined,
  jobLocalId: v.job_id,
  jobRemoteId: jobRemote[v.job_id as number],
  name: v.name,
  description: v.description ?? null,
  defaultValue: v.default_value ?? null,
  autoUpdate: Boolean(v.auto_update),
  sourceColumn: v.source_column ?? null,
  updateFn: v.update_fn ?? 'max',
  values: jobVariableValues
    .filter((val) => val.job_variable_id === v.id)
    .map((val) => ({
      connectionRemoteId: connRemote[val.connection_id as number],
      value: val.value ?? null,
      lastRunAt: val.last_run_at ?? null
    }))
    .filter((val) => !!val.connectionRemoteId)
}))
```

After push, persist returned remote_ids:

```typescript
applyMap('job_variables', maps.jobVariables)
```

> **Note:** `job_variables` table needs a `remote_id TEXT` column. Add migration v23.

---

### 6c. `src/main/services/sync/sync.service.ts` — PULL

**Add to `RemoteJob` type:**

```typescript
type RemoteJob = RemoteBase & {
  ...existing fields...
  modifyDates: boolean
  summaryExtraColumns: string[] | null
  excelCombineSheets: boolean
}
```

**Update INSERT/UPDATE statements for jobs** to include the 3 new fields:

- Add `modify_dates, summary_extra_columns, excel_combine_sheets` to the INSERT column list
- Add them to the UPDATE SET clause
- Add them to the `params` object mapping

**Add `RemoteJobVariable` type and pull logic:**

```typescript
type RemoteJobVariable = RemoteBase & {
  jobId: string
  name: string
  description: string | null
  defaultValue: string | null
  autoUpdate: boolean
  sourceColumn: string | null
  updateFn: string
  values: { connectionId: string; value: string | null; lastRunAt: string | null }[]
}
```

After pulling jobs (to have local job IDs available), pull and upsert job variables:

```typescript
const txJV = db.transaction((rows: RemoteJobVariable[]) => {
  for (const v of rows) {
    const localJobId = jobLocal.get(v.jobId)
    if (!localJobId) continue
    // upsert into job_variables
    // for each value: resolve connectionId from connLocal, upsert into job_variable_values
  }
})
txJV(data.jobVariables ?? [])
```

---

### 6d. `src/main/ipc/job-variable.ipc.ts` — call mirror functions

When a variable is created/updated/deleted or a value is set, call the corresponding mirror
function (same pattern as `connection.ipc.ts` already does with `mirrorConnectionCreate`, etc.).

---

### 6e. DB Migration v23 — add `remote_id` to `job_variables`

```typescript
{
  version: 23,
  fn(db: Database.Database): void {
    const cols = (db.prepare('PRAGMA table_info(job_variables)').all() as { name: string }[]).map(c => c.name)
    if (!cols.includes('remote_id')) {
      db.exec('ALTER TABLE job_variables ADD COLUMN remote_id TEXT DEFAULT NULL')
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_variables_remote_id ON job_variables(remote_id)')
    }
  }
}
```

---

## 7. Summary — All Changes At a Glance

### Backend (server)

| Change                                                                                 | Status     |
| -------------------------------------------------------------------------------------- | ---------- |
| Add `modify_dates`, `summary_extra_columns`, `excel_combine_sheets` to job model/table | ⏳ Pending |
| Update `POST/PATCH /jobs` to accept new fields                                         | ⏳ Pending |
| Update `GET /sync/pull` jobs to return new fields                                      | ⏳ Pending |
| Update `POST /sync/push` to accept new fields in job payload                           | ⏳ Pending |
| Create `job_variables` + `job_variable_values` tables on server                        | ⏳ Pending |
| Add `GET/POST/PATCH/DELETE /job-variables` endpoints                                   | ⏳ Pending |
| Add `POST /job-variables/:id/values` endpoint                                          | ⏳ Pending |
| Include `jobVariables` in `/sync/push` payload handling                                | ⏳ Pending |
| Include `jobVariables` in `/sync/pull` response                                        | ⏳ Pending |

### App (this repo)

| File                                     | Change                                                                                  | Status     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| `src/main/services/sync/mirror.ts`       | Add `modify_dates`, `summary_extra_columns`, `excel_combine_sheets` to `buildJobBody()` | ✅ Done    |
| `src/main/services/sync/sync.service.ts` | Add 3 fields to push job mapper                                                         | ✅ Done    |
| `src/main/services/sync/sync.service.ts` | Add 3 fields to pull `RemoteJob` type and INSERT/UPDATE params                          | ✅ Done    |
| `src/main/db/migrate.ts`                 | Migration v23 — `remote_id` column on `job_variables`                                   | ⏳ Pending |
| `src/main/services/sync/mirror.ts`       | Add `mirrorJobVariable*` functions                                                      | ⏳ Pending |
| `src/main/services/sync/sync.service.ts` | Add `jobVariables` to push payload                                                      | ⏳ Pending |
| `src/main/services/sync/sync.service.ts` | Add `jobVariables` to pull response type and upsert logic                               | ⏳ Pending |
| `src/main/ipc/job-variable.ipc.ts`       | Call mirror functions on create/update/delete/setValue                                  | ⏳ Pending |

---

## 8. Quick Fix — Most Common User Complaint (do this first)

The most user-visible broken behavior is that **`modify_dates`, `summary_extra_columns`, and
`excel_combine_sheets` are silently lost on re-login**. These are all in the existing jobs table
and just need to flow through the existing sync pipes.

**Minimum viable fix — 3 files, ~20 lines total:**

### `mirror.ts` — `buildJobBody()`

```typescript
// add after 'status: row.status ?? idle':
modify_dates: row.modify_dates !== false,
summary_extra_columns: row.summary_extra_columns ?? null,
excel_combine_sheets: !!row.excel_combine_sheets,
```

### `sync.service.ts` — push jobs mapper (around line 200)

```typescript
// add after 'status':
modify_dates: Boolean(r.modify_dates),
summary_extra_columns: (() => {
  try { return JSON.parse((r.summary_extra_columns as string) ?? 'null') } catch { return null }
})(),
excel_combine_sheets: Boolean(r.excel_combine_sheets),
```

### `sync.service.ts` — `RemoteJob` type + pull INSERT/UPDATE

```typescript
// In RemoteJob type, add:
modifyDates: boolean
summaryExtraColumns: string[] | null
excelCombineSheets: boolean

// In insertJob SQL, add columns: modify_dates, summary_extra_columns, excel_combine_sheets
// In updateJob SQL, add SET clauses for same
// In params object, add:
modify_dates: r.modifyDates ? 1 : 0,
summary_extra_columns: r.summaryExtraColumns ? JSON.stringify(r.summaryExtraColumns) : null,
excel_combine_sheets: r.excelCombineSheets ? 1 : 0,
```

This fix alone covers the 3 job fields. Job variables sync is a separate, larger backend effort.
