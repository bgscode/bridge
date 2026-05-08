/**
 * Mirroring of admin writes from local IPC to the remote backend.
 *
 * Server is the source of truth. For admin users, every create/update/delete
 * is sent to the server FIRST and any failure is THROWN so the renderer shows
 * a visible error instead of silently diverging from the server. For non-admin
 * users (who cannot push catalog/job edits anyway), the call is skipped.
 */
import { getAuthToken, isAdmin } from '../auth-context'
import db from '../../db/index'
import type { ConnectionRow, JobRow, JobVariable } from '@shared/index'

const API_BASE = process.env.BRIDGE_API_URL
let hasWarnedMissingJobConnectionsRoute = false

/**
 * Calls the server. Returns `null` only when the user is not an admin (or not
 * logged in) — in which case the write stays local-only. Any other failure
 * (network, 4xx/5xx, server error response) THROWS so the IPC handler can
 * surface the error to the renderer.
 */
async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { adminOnly?: boolean; suppressErrorLog?: boolean } = { adminOnly: true }
): Promise<T | null> {
  if (!API_BASE) return null
  const token = getAuthToken()
  if (!token) return null
  if (options.adminOnly !== false && !isAdmin()) return null
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[mirror] ${method} ${path} network error:`, msg)
    throw new Error(`Server unreachable (${method} ${path}): ${msg}`)
  }
  let data: { success: boolean; data?: T; error?: string; message?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    throw new Error(`Server returned non-JSON ${res.status} for ${method} ${path}`)
  }
  if (!res.ok || !data.success) {
    const err = data.error || data.message || `HTTP ${res.status}`
    if (!options.suppressErrorLog) {
      console.error(`[mirror] ${method} ${path} failed:`, err)
    }
    throw new Error(`Server rejected ${method} ${path}: ${err}`)
  }
  return data.data ?? null
}

function assertRemoteWriteAvailable<T>(result: T | null, action: string): T {
  if (result !== null) {
    return result
  }

  throw new Error(`${action} requires a configured backend URL and an authenticated session.`)
}

function remoteIdOf(table: string, localId: number | null | undefined): string | null {
  if (!localId) return null
  const row = db.prepare(`SELECT remote_id FROM ${table} WHERE id = ?`).get(localId) as
    | { remote_id: string | null }
    | undefined
  return row?.remote_id ?? null
}

function saveRemoteId(table: string, localId: number, remoteId: string): void {
  db.prepare(`UPDATE ${table} SET remote_id = ? WHERE id = ?`).run(remoteId, localId)
}

// ── Connections ────────────────────────────────────────────────────────────

function buildConnectionBody(row: ConnectionRow): Record<string, unknown> {
  return {
    name: row.name,
    group_id: remoteIdOf('groups', row.group_id),
    static_ip: row.static_ip ?? '',
    vpn_ip: row.vpn_ip ?? '',
    db_name: row.db_name ?? '',
    username: row.username ?? '',
    password: row.password ?? '',
    trust_cert: !!row.trust_cert,
    fiscal_year_id: remoteIdOf('fiscal_years', row.fiscal_year_id),
    store_id: remoteIdOf('stores', row.store_id),
    status: row.status ?? 'unknown'
  }
}

export async function mirrorConnectionCreate(row: ConnectionRow): Promise<void> {
  const created = await call<{ id: string }>('POST', '/connections', buildConnectionBody(row))
  if (created?.id) saveRemoteId('connections', row.id, created.id)
}

export async function mirrorConnectionUpdate(row: ConnectionRow): Promise<void> {
  const rid = row.remote_id ?? remoteIdOf('connections', row.id)
  if (!rid) {
    await mirrorConnectionCreate(row)
    return
  }
  await call('PATCH', `/connections/${rid}`, buildConnectionBody(row))
}

export async function mirrorConnectionDelete(localId: number): Promise<void> {
  const rid = remoteIdOf('connections', localId)
  if (!rid) return
  await call('DELETE', `/connections/${rid}`)
}

// ── Jobs ───────────────────────────────────────────────────────────────────

function buildJobBody(row: JobRow, mode: 'create' | 'update' = 'update'): Record<string, unknown> {
  const connRemoteIds = Array.from(
    new Set(
      (row.connection_ids ?? [])
        .map((cid) => remoteIdOf('connections', cid))
        .filter((x): x is string => !!x)
    )
  )
  const jobGroupRemoteId = remoteIdOf('job_groups', row.job_group_id)
  const body: Record<string, unknown> = {
    name: row.name,
    description: row.description ?? null,
    job_color: row.job_color ?? null,
    connection_ids: connRemoteIds,
    online_only: !!row.online_only,
    is_multi: !!row.is_multi,
    type: row.type ?? 'query',
    sql_query: row.sql_query ?? [],
    sql_query_names: row.sql_query_names ?? [],
    destination_type: row.destination_type ?? null,
    destination_config: row.destination_config ?? null,
    operation: row.operation ?? null,
    notify_webhook: row.notify_webhook ?? null,
    template_path: row.template_path ?? null,
    template_mode: row.template_mode ?? null,
    schedule: row.schedule ?? null,
    status: row.status ?? 'idle',
    modify_dates: row.modify_dates !== false,
    summary_extra_columns: row.summary_extra_columns ?? null,
    excel_combine_sheets: !!row.excel_combine_sheets
  }
  // On create, omit job_group_id when null — sending null causes the server
  // to emit `jobGroup: { disconnect: true }` which Prisma rejects on create.
  // On update, always include it so the server can disconnect an existing group.
  if (mode === 'create') {
    if (jobGroupRemoteId) body.job_group_id = jobGroupRemoteId
  } else {
    body.job_group_id = jobGroupRemoteId
  }
  return body
}

function buildLegacyJobBody(
  row: JobRow,
  mode: 'create' | 'update' = 'update'
): Record<string, unknown> {
  const body = buildJobBody(row, mode)

  delete body.job_color
  delete body.summary_extra_columns
  delete body.excel_combine_sheets

  return body
}

function isLegacyJobFieldError(message: string): boolean {
  return /Unknown argument `(jobColor|summaryExtraColumns|excelCombineSheets)`/i.test(message)
}

export async function mirrorJobCreate(row: JobRow): Promise<void> {
  let created: { id: string } | null

  try {
    created = await call<{ id: string }>('POST', '/jobs', buildJobBody(row, 'create'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!isLegacyJobFieldError(message)) {
      throw error
    }

    console.warn(
      '[mirror] job create rejected newer fields on server; retrying with legacy-compatible payload'
    )

    created = await call<{ id: string }>('POST', '/jobs', buildLegacyJobBody(row, 'create'))
  }

  if (created?.id) saveRemoteId('jobs', row.id, created.id)
}

export async function mirrorJobUpdate(row: JobRow): Promise<void> {
  const rid = row.remote_id ?? remoteIdOf('jobs', row.id)
  if (!rid) {
    await mirrorJobCreate(row)
    return
  }

  try {
    assertRemoteWriteAvailable(await call('PATCH', `/jobs/${rid}`, buildJobBody(row)), 'Job update')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!isLegacyJobFieldError(message)) {
      throw error
    }

    console.warn(
      '[mirror] job update rejected newer fields on server; retrying with legacy-compatible payload'
    )

    assertRemoteWriteAvailable(
      await call('PATCH', `/jobs/${rid}`, buildLegacyJobBody(row)),
      'Job update compatibility fallback'
    )
  }
}

export async function mirrorJobConnectionsUpdate(row: JobRow): Promise<void> {
  const rid = row.remote_id ?? remoteIdOf('jobs', row.id)

  if (!rid) {
    await mirrorJobCreate(row)
    return
  }

  const connectionIds = Array.from(
    new Set(
      (row.connection_ids ?? [])
        .map((cid) => remoteIdOf('connections', cid))
        .filter((value): value is string => !!value)
    )
  )

  try {
    assertRemoteWriteAvailable(
      await call(
        'PATCH',
        `/jobs/${rid}/connections`,
        { connection_ids: connectionIds },
        { adminOnly: false, suppressErrorLog: true }
      ),
      'Job connection update'
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!/Route not found .*\/api\/jobs\/[^/]+\/connections/i.test(message)) {
      throw error
    }

    if (!hasWarnedMissingJobConnectionsRoute) {
      hasWarnedMissingJobConnectionsRoute = true
      console.warn(
        '[mirror] job connections route missing on server; falling back to PATCH /jobs/:id compatibility path'
      )
    }

    assertRemoteWriteAvailable(
      await call('PATCH', `/jobs/${rid}`, { connection_ids: connectionIds }, { adminOnly: false }),
      'Job connection update fallback'
    )
  }
}

export async function mirrorJobDelete(localId: number): Promise<void> {
  const rid = remoteIdOf('jobs', localId)
  if (!rid) return
  await call('DELETE', `/jobs/${rid}`)
}

// ── Job Variables ─────────────────────────────────────────────────────────

function buildJobVariableBody(row: JobVariable): Record<string, unknown> | null {
  const jobId = remoteIdOf('jobs', row.job_id)
  if (!jobId) return null
  return {
    jobId,
    name: row.name,
    description: row.description ?? null,
    defaultValue: row.default_value ?? null,
    autoUpdate: !!row.auto_update,
    sourceColumn: row.source_column ?? null,
    updateFn: row.update_fn ?? 'max'
  }
}

export async function mirrorJobVariableCreate(row: JobVariable): Promise<void> {
  const body = buildJobVariableBody(row)
  if (!body) return
  const created = await call<{ id: string }>('POST', '/job-variables', body, { adminOnly: false })
  if (created?.id) saveRemoteId('job_variables', row.id, created.id)
}

export async function mirrorJobVariableUpdate(row: JobVariable): Promise<void> {
  const rid = row.remote_id ?? remoteIdOf('job_variables', row.id)
  if (!rid) {
    await mirrorJobVariableCreate(row)
    return
  }
  const body = buildJobVariableBody(row)
  if (!body) return
  await call('PATCH', `/job-variables/${rid}`, body, { adminOnly: false })
}

export async function mirrorJobVariableDelete(localId: number): Promise<void> {
  const rid = remoteIdOf('job_variables', localId)
  if (!rid) return
  await call('DELETE', `/job-variables/${rid}`, undefined, { adminOnly: false })
}

export async function mirrorJobVariableSetValue(
  jobVariableId: number,
  connectionId: number,
  value: string
): Promise<void> {
  const variableRemoteId = remoteIdOf('job_variables', jobVariableId)
  const connectionRemoteId = remoteIdOf('connections', connectionId)
  if (!variableRemoteId || !connectionRemoteId) return
  await call(
    'POST',
    `/job-variables/${variableRemoteId}/values`,
    {
      connectionId: connectionRemoteId,
      value,
      lastRunAt: new Date().toISOString()
    },
    { adminOnly: false }
  )
}

export async function mirrorJobVariableDeleteConnectionValues(
  jobId: number,
  connectionId: number
): Promise<void> {
  const jobRemoteId = remoteIdOf('jobs', jobId)
  const connectionRemoteId = remoteIdOf('connections', connectionId)
  if (!jobRemoteId || !connectionRemoteId) return
  await call(
    'DELETE',
    `/job-variables/by-job/${jobRemoteId}/by-connection/${connectionRemoteId}`,
    undefined,
    {
      adminOnly: false
    }
  )
}

// ── Catalog upsert helpers (groups / job_groups / stores / fiscal_years) ──

async function upsertCatalog(
  kind: 'groups' | 'job-groups' | 'stores' | 'fiscal-years',
  table: string,
  localId: number,
  body: Record<string, unknown>
): Promise<void> {
  const rid = remoteIdOf(table, localId)
  if (rid) {
    await call('PATCH', `/${kind}/${rid}`, body)
    return
  }
  const created = await call<{ id: string }>('POST', `/${kind}`, body)
  if (created?.id) saveRemoteId(table, localId, created.id)
}

async function deleteCatalog(
  kind: 'groups' | 'job-groups' | 'stores' | 'fiscal-years',
  table: string,
  localId: number
): Promise<void> {
  const rid = remoteIdOf(table, localId)
  if (!rid) return
  await call('DELETE', `/${kind}/${rid}`)
}

export const mirrorGroup = {
  upsert: (row: { id: number; name: string; description?: string | null }) =>
    upsertCatalog('groups', 'groups', row.id, {
      name: row.name,
      description: row.description ?? null
    }),
  remove: (localId: number) => deleteCatalog('groups', 'groups', localId)
}

export const mirrorJobGroup = {
  upsert: (row: { id: number; name: string; description?: string | null }) =>
    upsertCatalog('job-groups', 'job_groups', row.id, {
      name: row.name,
      description: row.description ?? null
    }),
  remove: (localId: number) => deleteCatalog('job-groups', 'job_groups', localId)
}

export const mirrorStore = {
  upsert: (row: { id: number; name: string; code: string }) =>
    upsertCatalog('stores', 'stores', row.id, { name: row.name, code: row.code }),
  remove: (localId: number) => deleteCatalog('stores', 'stores', localId)
}

export const mirrorFiscalYear = {
  upsert: (row: { id: number; name: string }) =>
    upsertCatalog('fiscal-years', 'fiscal_years', row.id, { name: row.name }),
  remove: (localId: number) => deleteCatalog('fiscal-years', 'fiscal_years', localId)
}
