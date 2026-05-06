/**
 * Sync service — bidirectional sync between local SQLite and remote backend.
 *
 * Strategy:
 *   1. PUSH: read local rows, send to POST /api/sync/push with (localId, remoteId, fields).
 *      Server upserts and returns {localId -> remoteId} maps. We persist remote_id.
 *   2. PULL: GET /api/sync/pull returns all server state. Upsert locally by remote_id.
 *
 * Server = master. Local = cache.
 */
import db from '../../db/index'

const API_BASE = process.env.BRIDGE_API_URL as string

export type SyncResult = {
  pushed: {
    stores: number
    fiscalYears: number
    groups: number
    jobGroups: number
    connections: number
    jobs: number
    jobVariables: number
    settings: number
  }
  pulled: {
    stores: number
    fiscalYears: number
    groups: number
    jobGroups: number
    connections: number
    jobs: number
    jobVariables: number
    settings: number
  }
}

type Row = Record<string, unknown>

function json(token: string | null, extra: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return { ...extra, headers: { ...headers, ...(extra.headers as Record<string, string>) } }
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(
    `${API_BASE}${path}`,
    json(token, { method: 'POST', body: JSON.stringify(body) })
  )
  const data = (await res.json()) as {
    success: boolean
    data?: T
    error?: string
    message?: string
  }
  if (!res.ok || !data.success) throw new Error(data.error || data.message || `POST ${path} failed`)
  return data.data as T
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, json(token))
  const data = (await res.json()) as {
    success: boolean
    data?: T
    error?: string
    message?: string
  }
  if (!res.ok || !data.success) throw new Error(data.error || data.message || `GET ${path} failed`)
  return data.data as T
}

// ── helpers to read local rows with camelCase mapping expected by backend ──

function collectLocal() {
  const stores = db.prepare('SELECT id, name, code, remote_id FROM stores').all() as Row[]
  const fiscalYears = db.prepare('SELECT id, name, remote_id FROM fiscal_years').all() as Row[]
  const groups = db.prepare('SELECT id, name, description, remote_id FROM groups').all() as Row[]
  const jobGroups = db
    .prepare('SELECT id, name, description, remote_id FROM job_groups')
    .all() as Row[]
  const settings = db.prepare('SELECT key, value FROM settings').all() as Row[]
  const connections = db.prepare('SELECT * FROM connections').all() as Row[]
  const jobs = db.prepare('SELECT * FROM jobs').all() as Row[]
  const jobVariables = db.prepare('SELECT * FROM job_variables').all() as Row[]
  const jobVariableValues = db.prepare('SELECT * FROM job_variable_values').all() as Row[]
  return {
    stores,
    fiscalYears,
    groups,
    jobGroups,
    settings,
    connections,
    jobs,
    jobVariables,
    jobVariableValues
  }
}

function localIdByRemoteId(table: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT id, remote_id FROM ${table} WHERE remote_id IS NOT NULL`)
    .all() as { id: number; remote_id: string }[]
  return new Map(rows.map((r) => [r.remote_id, r.id]))
}

// ── PUSH ────────────────────────────────────────────────────────────────────

async function pushAll(token: string) {
  const local = collectLocal()

  // Build FK lookup for connections/jobs: local fk id -> remote id (if known)
  const storeRemote = Object.fromEntries(
    (local.stores as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )
  const fyRemote = Object.fromEntries(
    (local.fiscalYears as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )
  const groupRemote = Object.fromEntries(
    (local.groups as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )
  const jgRemote = Object.fromEntries(
    (local.jobGroups as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )
  const connRemote = Object.fromEntries(
    (local.connections as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )
  const jobRemote = Object.fromEntries(
    (local.jobs as { id: number; remote_id: string | null }[])
      .filter((r) => r.remote_id)
      .map((r) => [r.id, r.remote_id as string])
  )

  const payload = {
    stores: local.stores.map((r) => ({
      localId: r.id as number,
      remoteId: (r.remote_id as string | null) ?? undefined,
      name: String(r.name),
      code: String(r.code)
    })),
    fiscalYears: local.fiscalYears.map((r) => ({
      localId: r.id as number,
      remoteId: (r.remote_id as string | null) ?? undefined,
      name: String(r.name)
    })),
    groups: local.groups.map((r) => ({
      localId: r.id as number,
      remoteId: (r.remote_id as string | null) ?? undefined,
      name: String(r.name),
      description: (r.description as string | null) ?? null
    })),
    jobGroups: local.jobGroups.map((r) => ({
      localId: r.id as number,
      remoteId: (r.remote_id as string | null) ?? undefined,
      name: String(r.name),
      description: (r.description as string | null) ?? null
    })),
    settings: local.settings.map((r) => ({
      key: String(r.key),
      value: String(r.value)
    })),
    connections: local.connections.map((r) => ({
      localId: r.id as number,
      remoteId: (r.remote_id as string | null) ?? undefined,
      name: String(r.name),
      groupLocalId: (r.group_id as number | null) ?? null,
      groupRemoteId: r.group_id ? groupRemote[r.group_id as number] : undefined,
      storeLocalId: (r.store_id as number | null) ?? null,
      storeRemoteId: r.store_id ? storeRemote[r.store_id as number] : undefined,
      fiscalYearLocalId: (r.fiscal_year_id as number | null) ?? null,
      fiscalYearRemoteId: r.fiscal_year_id ? fyRemote[r.fiscal_year_id as number] : undefined,
      static_ip: (r.static_ip as string) ?? '',
      vpn_ip: (r.vpn_ip as string) ?? '',
      db_name: (r.db_name as string) ?? '',
      username: (r.username as string) ?? '',
      password: (r.password as string) ?? '',
      trust_cert: Boolean(r.trust_cert),
      status: (r.status as string) ?? 'unknown'
    })),
    jobs: local.jobs.map((r) => {
      const connIds: number[] = (() => {
        try {
          return JSON.parse((r.connection_ids as string) ?? '[]') as number[]
        } catch {
          return []
        }
      })()
      const sqlQuery: string[] = (() => {
        try {
          return JSON.parse((r.sql_query as string) ?? '[]') as string[]
        } catch {
          return []
        }
      })()
      const sqlQueryNames: string[] = (() => {
        try {
          return JSON.parse((r.sql_query_names as string) ?? '[]') as string[]
        } catch {
          return []
        }
      })()
      return {
        localId: r.id as number,
        remoteId: (r.remote_id as string | null) ?? undefined,
        name: String(r.name),
        description: (r.description as string | null) ?? null,
        jobGroupLocalId: (r.job_group_id as number | null) ?? null,
        jobGroupRemoteId: r.job_group_id ? jgRemote[r.job_group_id as number] : undefined,
        connectionLocalIds: connIds,
        connectionRemoteIds: connIds.map((cid) => connRemote[cid]).filter((x): x is string => !!x),
        online_only: Boolean(r.online_only),
        is_multi: Boolean(r.is_multi),
        type: (r.type as 'query' | 'action') ?? 'query',
        sql_query: sqlQuery,
        sql_query_names: sqlQueryNames,
        destination_type: (r.destination_type as 'api' | 'google_sheets' | 'excel' | null) ?? null,
        destination_config: (r.destination_config as string | null) ?? null,
        operation: (r.operation as 'append' | 'replace' | null) ?? null,
        notify_webhook: (r.notify_webhook as string | null) ?? null,
        template_path: (r.template_path as string | null) ?? null,
        template_mode: (r.template_mode as 'new' | 'existing' | null) ?? null,
        schedule: (r.schedule as string | null) ?? null,
        status: (r.status as 'idle' | 'running' | 'success' | 'failed') ?? 'idle',
        modify_dates: Boolean(r.modify_dates),
        summary_extra_columns: (() => {
          try {
            return JSON.parse((r.summary_extra_columns as string) ?? 'null') as string[] | null
          } catch {
            return null
          }
        })(),
        excel_combine_sheets: Boolean(r.excel_combine_sheets)
      }
    }),
    jobVariables: local.jobVariables.map((v) => ({
      localId: v.id as number,
      remoteId: (v.remote_id as string | null) ?? undefined,
      jobLocalId: (v.job_id as number | null) ?? null,
      jobRemoteId: v.job_id ? jobRemote[v.job_id as number] : undefined,
      name: String(v.name),
      description: (v.description as string | null) ?? null,
      defaultValue: (v.default_value as string | null) ?? null,
      autoUpdate: Boolean(v.auto_update),
      sourceColumn: (v.source_column as string | null) ?? null,
      updateFn: (v.update_fn as 'max' | 'min' | 'last') ?? 'max',
      values: local.jobVariableValues
        .filter((val) => val.job_variable_id === v.id)
        .map((val) => ({
          connectionLocalId: val.connection_id as number,
          connectionRemoteId: connRemote[val.connection_id as number] ?? undefined,
          value: (val.value as string | null) ?? null,
          lastRunAt: (val.last_run_at as string | null) ?? null
        }))
    }))
  }

  type PushResponse = {
    stores: Record<number, string>
    fiscalYears: Record<number, string>
    groups: Record<number, string>
    jobGroups: Record<number, string>
    connections: Record<number, string>
    jobs: Record<number, string>
    jobVariables?: Record<number, string>
  }

  const maps = await post<PushResponse>('/sync/push', token, payload)

  // Persist returned remote_ids
  const applyMap = (table: string, map: Record<number, string> | undefined) => {
    if (!map) return
    const stmt = db.prepare(`UPDATE ${table} SET remote_id = ? WHERE id = ?`)
    const tx = db.transaction((entries: [number, string][]) => {
      for (const [id, rid] of entries) stmt.run(rid, id)
    })
    tx(Object.entries(map).map(([k, v]) => [Number(k), v] as [number, string]))
  }
  applyMap('stores', maps.stores)
  applyMap('fiscal_years', maps.fiscalYears)
  applyMap('groups', maps.groups)
  applyMap('job_groups', maps.jobGroups)
  applyMap('connections', maps.connections)
  applyMap('jobs', maps.jobs)
  applyMap('job_variables', maps.jobVariables)

  return {
    stores: Object.keys(maps.stores).length,
    fiscalYears: Object.keys(maps.fiscalYears).length,
    groups: Object.keys(maps.groups).length,
    jobGroups: Object.keys(maps.jobGroups).length,
    connections: Object.keys(maps.connections).length,
    jobs: Object.keys(maps.jobs).length,
    jobVariables: Object.keys(maps.jobVariables ?? {}).length,
    settings: payload.settings.length
  }
}

// ── PULL ────────────────────────────────────────────────────────────────────

type RemoteBase = { id: string; createdAt?: string; updatedAt?: string }
type RemoteStore = RemoteBase & { name: string; code: string }
type RemoteFY = RemoteBase & { name: string }
type RemoteGroup = RemoteBase & { name: string; description: string | null }
type RemoteJobGroup = RemoteGroup
type RemoteSetting = { key: string; value: string }
type RemoteConnection = RemoteBase & {
  name: string
  ownerId: string
  groupId: string | null
  storeId: string | null
  fiscalYearId: string | null
  staticIp: string
  vpnIp: string
  dbName: string
  username: string
  password: string
  trustCert: boolean
  status: string
}
type RemoteJob = RemoteBase & {
  name: string
  ownerId: string
  description: string | null
  jobGroupId: string | null
  connectionIds: string[]
  onlineOnly: boolean
  isMulti: boolean
  type: string
  sqlQuery: string[]
  sqlQueryNames: string[] | null
  destinationType: string | null
  destinationConfig: string | null
  operation: string | null
  notifyWebhook: string | null
  templatePath: string | null
  templateMode: string | null
  schedule: string | null
  status: string
  lastRunAt: string | null
  lastError: string | null
  modifyDates: boolean | null
  summaryExtraColumns: string[] | null
  excelCombineSheets: boolean | null
}
type RemoteJobVariable = RemoteBase & {
  jobId: string
  name: string
  description: string | null
  defaultValue: string | null
  autoUpdate: boolean
  sourceColumn: string | null
  updateFn: 'max' | 'min' | 'last'
  values: Array<{
    connectionId: string
    value: string | null
    lastRunAt: string | null
  }>
}
type PullData = {
  stores: RemoteStore[]
  fiscalYears: RemoteFY[]
  groups: RemoteGroup[]
  jobGroups: RemoteJobGroup[]
  settings: RemoteSetting[]
  connections: RemoteConnection[]
  jobs: RemoteJob[]
  jobVariables?: RemoteJobVariable[]
}

async function pullAll(token: string): Promise<SyncResult['pulled']> {
  const data = await get<PullData>('/sync/pull', token)

  // Snapshot local sql_query_names keyed by remote_id BEFORE the wipe so we
  // can restore them if the server returns null (e.g. column not yet migrated
  // on Postgres, or the mirror PATCH failed silently).
  const localQueryNamesSnapshot = new Map<string, string>()
  ;(
    db.prepare('SELECT remote_id, sql_query_names FROM jobs WHERE remote_id IS NOT NULL').all() as {
      remote_id: string
      sql_query_names: string | null
    }[]
  ).forEach((r) => {
    if (r.remote_id && r.sql_query_names) {
      localQueryNamesSnapshot.set(r.remote_id, r.sql_query_names)
    }
  })

  // Server is master: wipe local state and rebuild from server snapshot.
  // Order matters — jobs → connections → catalog (no FK violations).
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM job_variable_values').run()
    db.prepare('DELETE FROM job_variables').run()
    db.prepare('DELETE FROM jobs').run()
    db.prepare('DELETE FROM connections').run()
    db.prepare('DELETE FROM stores').run()
    db.prepare('DELETE FROM fiscal_years').run()
    db.prepare('DELETE FROM groups').run()
    db.prepare('DELETE FROM job_groups').run()
  })
  wipe()

  // ── Stores / FY / Groups / JobGroups ────────────────────────────────────
  const upsertStore = db.prepare(`
    INSERT INTO stores (name, code, remote_id) VALUES (@name, @code, @remote_id)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      remote_id = excluded.remote_id,
      updated_at = datetime('now')
  `)
  const txStores = db.transaction((rows: RemoteStore[]) => {
    for (const r of rows) upsertStore.run({ name: r.name, code: r.code, remote_id: r.id })
  })
  txStores(data.stores)

  const upsertFY = db.prepare(`
    INSERT INTO fiscal_years (name, remote_id) VALUES (@name, @remote_id)
    ON CONFLICT(name) DO UPDATE SET
      remote_id = excluded.remote_id,
      updated_at = datetime('now')
  `)
  const txFY = db.transaction((rows: RemoteFY[]) => {
    for (const r of rows) upsertFY.run({ name: r.name, remote_id: r.id })
  })
  txFY(data.fiscalYears)

  const upsertGroup = db.prepare(`
    INSERT INTO groups (name, description, remote_id) VALUES (@name, @description, @remote_id)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      remote_id = excluded.remote_id,
      updated_at = datetime('now')
  `)
  const txG = db.transaction((rows: RemoteGroup[]) => {
    for (const r of rows)
      upsertGroup.run({ name: r.name, description: r.description, remote_id: r.id })
  })
  txG(data.groups)

  const upsertJG = db.prepare(`
    INSERT INTO job_groups (name, description, remote_id) VALUES (@name, @description, @remote_id)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      remote_id = excluded.remote_id,
      updated_at = datetime('now')
  `)
  const txJG = db.transaction((rows: RemoteJobGroup[]) => {
    for (const r of rows)
      upsertJG.run({ name: r.name, description: r.description, remote_id: r.id })
  })
  txJG(data.jobGroups)

  // Settings — upsert by key
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const txS = db.transaction((rows: RemoteSetting[]) => {
    for (const r of rows) upsertSetting.run(r.key, r.value)
  })
  txS(data.settings)

  // Build local id lookup by remote_id (AFTER upserts)
  const storeLocal = localIdByRemoteId('stores')
  const fyLocal = localIdByRemoteId('fiscal_years')
  const groupLocal = localIdByRemoteId('groups')
  const jgLocal = localIdByRemoteId('job_groups')

  // ── Connections ─────────────────────────────────────────────────────────
  const findConn = db.prepare('SELECT id FROM connections WHERE remote_id = ?')
  const insertConn = db.prepare(`
    INSERT INTO connections (name, group_id, static_ip, vpn_ip, db_name, username, password, trust_cert, fiscal_year_id, store_id, status, remote_id)
    VALUES (@name, @group_id, @static_ip, @vpn_ip, @db_name, @username, @password, @trust_cert, @fiscal_year_id, @store_id, @status, @remote_id)
  `)
  const updateConn = db.prepare(`
    UPDATE connections SET
      name = @name,
      group_id = @group_id,
      static_ip = @static_ip,
      vpn_ip = @vpn_ip,
      db_name = @db_name,
      username = @username,
      password = @password,
      trust_cert = @trust_cert,
      fiscal_year_id = @fiscal_year_id,
      store_id = @store_id,
      status = @status,
      updated_at = datetime('now')
    WHERE remote_id = @remote_id
  `)
  const txC = db.transaction((rows: RemoteConnection[]) => {
    for (const r of rows) {
      const params = {
        name: r.name,
        group_id: r.groupId ? (groupLocal.get(r.groupId) ?? null) : null,
        static_ip: r.staticIp ?? '',
        vpn_ip: r.vpnIp ?? '',
        db_name: r.dbName ?? '',
        username: r.username ?? '',
        password: r.password ?? '',
        trust_cert: r.trustCert ? 1 : 0,
        fiscal_year_id: r.fiscalYearId ? (fyLocal.get(r.fiscalYearId) ?? null) : null,
        store_id: r.storeId ? (storeLocal.get(r.storeId) ?? null) : null,
        status: r.status,
        remote_id: r.id
      }
      const existing = findConn.get(r.id) as { id: number } | undefined
      if (existing) updateConn.run(params)
      else insertConn.run(params)
    }
  })
  txC(data.connections)

  const connLocal = localIdByRemoteId('connections')

  // ── Jobs ────────────────────────────────────────────────────────────────
  const findJob = db.prepare('SELECT id FROM jobs WHERE remote_id = ?')
  const insertJob = db.prepare(`
    INSERT INTO jobs (
      name, description, job_group_id, connection_ids, online_only, is_multi,
      type, sql_query, sql_query_names, destination_type, destination_config, operation, notify_webhook,
      template_path, template_mode, schedule, status, last_run_at, last_error,
      modify_dates, summary_extra_columns, excel_combine_sheets, remote_id
    ) VALUES (
      @name, @description, @job_group_id, @connection_ids, @online_only, @is_multi,
      @type, @sql_query, @sql_query_names, @destination_type, @destination_config, @operation, @notify_webhook,
      @template_path, @template_mode, @schedule, @status, @last_run_at, @last_error,
      @modify_dates, @summary_extra_columns, @excel_combine_sheets, @remote_id
    )
  `)
  const updateJob = db.prepare(`
    UPDATE jobs SET
      name = @name,
      description = @description,
      job_group_id = @job_group_id,
      connection_ids = @connection_ids,
      online_only = @online_only,
      is_multi = @is_multi,
      type = @type,
      sql_query = @sql_query,
      sql_query_names = @sql_query_names,
      destination_type = @destination_type,
      destination_config = @destination_config,
      operation = @operation,
      notify_webhook = @notify_webhook,
      template_path = @template_path,
      template_mode = @template_mode,
      schedule = @schedule,
      status = @status,
      last_run_at = @last_run_at,
      last_error = @last_error,
      modify_dates = @modify_dates,
      summary_extra_columns = @summary_extra_columns,
      excel_combine_sheets = @excel_combine_sheets,
      updated_at = datetime('now')
    WHERE remote_id = @remote_id
  `)
  const txJ = db.transaction((rows: RemoteJob[]) => {
    for (const r of rows) {
      const localConnIds = r.connectionIds
        .map((rid) => connLocal.get(rid))
        .filter((x): x is number => typeof x === 'number')

      // When the server returns null/empty for sql_query_names (e.g. because
      // the Postgres column migration hasn't run yet, or the mirror PATCH failed
      // silently), fall back to the snapshot taken before the wipe.
      let sqlQueryNames: string
      if (r.sqlQueryNames && r.sqlQueryNames.length > 0) {
        sqlQueryNames = JSON.stringify(r.sqlQueryNames)
      } else {
        sqlQueryNames = localQueryNamesSnapshot.get(r.id) ?? '[]'
      }

      const params = {
        name: r.name,
        description: r.description,
        job_group_id: r.jobGroupId ? (jgLocal.get(r.jobGroupId) ?? null) : null,
        connection_ids: JSON.stringify(localConnIds),
        online_only: r.onlineOnly ? 1 : 0,
        is_multi: r.isMulti ? 1 : 0,
        type: r.type,
        sql_query: JSON.stringify(r.sqlQuery ?? []),
        sql_query_names: sqlQueryNames,
        destination_type: r.destinationType,
        destination_config: r.destinationConfig,
        operation: r.operation,
        notify_webhook: r.notifyWebhook,
        template_path: r.templatePath,
        template_mode: r.templateMode,
        schedule: r.schedule,
        status: r.status,
        last_run_at: r.lastRunAt,
        last_error: r.lastError,
        modify_dates: r.modifyDates != null ? (r.modifyDates ? 1 : 0) : 1,
        summary_extra_columns: r.summaryExtraColumns ? JSON.stringify(r.summaryExtraColumns) : null,
        excel_combine_sheets: r.excelCombineSheets ? 1 : 0,
        remote_id: r.id
      }
      const existing = findJob.get(r.id) as { id: number } | undefined
      if (existing) updateJob.run(params)
      else insertJob.run(params)
    }
  })
  txJ(data.jobs)

  const jobLocal = localIdByRemoteId('jobs')
  const insertJobVariable = db.prepare(`
    INSERT INTO job_variables (
      job_id, remote_id, name, description, default_value, auto_update, source_column, update_fn,
      created_at, updated_at
    ) VALUES (
      @job_id, @remote_id, @name, @description, @default_value, @auto_update, @source_column, @update_fn,
      @created_at, @updated_at
    )
  `)
  const insertJobVariableValue = db.prepare(`
    INSERT INTO job_variable_values (job_variable_id, connection_id, value, last_run_at, updated_at)
    VALUES (@job_variable_id, @connection_id, @value, @last_run_at, @updated_at)
    ON CONFLICT(job_variable_id, connection_id)
    DO UPDATE SET value = excluded.value,
                  last_run_at = excluded.last_run_at,
                  updated_at = excluded.updated_at
  `)
  const txJV = db.transaction((rows: RemoteJobVariable[]) => {
    for (const r of rows) {
      const localJobId = jobLocal.get(r.jobId)
      if (!localJobId) continue

      const result = insertJobVariable.run({
        job_id: localJobId,
        remote_id: r.id,
        name: r.name,
        description: r.description,
        default_value: r.defaultValue,
        auto_update: r.autoUpdate ? 1 : 0,
        source_column: r.sourceColumn,
        update_fn: r.updateFn ?? 'max',
        created_at: r.createdAt ?? new Date().toISOString(),
        updated_at: r.updatedAt ?? new Date().toISOString()
      })
      const localVariableId = result.lastInsertRowid as number

      for (const value of r.values ?? []) {
        const localConnectionId = connLocal.get(value.connectionId)
        if (!localConnectionId) continue
        insertJobVariableValue.run({
          job_variable_id: localVariableId,
          connection_id: localConnectionId,
          value: value.value,
          last_run_at: value.lastRunAt,
          updated_at: new Date().toISOString()
        })
      }
    }
  })
  txJV(data.jobVariables ?? [])

  return {
    stores: data.stores.length,
    fiscalYears: data.fiscalYears.length,
    groups: data.groups.length,
    jobGroups: data.jobGroups.length,
    connections: data.connections.length,
    jobs: data.jobs.length,
    jobVariables: data.jobVariables?.length ?? 0,
    settings: data.settings.length
  }
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function syncAll(token: string): Promise<SyncResult> {
  if (!token) throw new Error('Authentication token required for sync')
  if (!API_BASE) throw new Error('BRIDGE_API_URL is not configured')
  // PULL-ONLY: server is master. Admin writes flow directly to server via REST.
  // For the initial seeding of pre-existing local data, call `pushOnce(token)`.
  const pulled = await pullAll(token)
  const pushed = {
    stores: 0,
    fiscalYears: 0,
    groups: 0,
    jobGroups: 0,
    connections: 0,
    jobs: 0,
    jobVariables: 0,
    settings: 0
  }
  return { pushed, pulled }
}

/**
 * One-time migration of the current local database up to the server.
 * Intended to be run exactly once per installation, right after the server
 * becomes the source of truth. Subsequent writes must go through REST.
 */
export async function pushOnce(token: string): Promise<SyncResult> {
  if (!token) throw new Error('Authentication token required for push')
  if (!API_BASE) throw new Error('BRIDGE_API_URL is not configured')
  const pushed = await pushAll(token)
  const pulled = await pullAll(token)
  return { pushed, pulled }
}
