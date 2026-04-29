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
import type { ConnectionRow, JobRow } from '@shared/index'

const API_BASE = process.env.BRIDGE_API_URL ?? 'https://link.yonolight.com/api'

/**
 * Calls the server. Returns `null` only when the user is not an admin (or not
 * logged in) — in which case the write stays local-only. Any other failure
 * (network, 4xx/5xx, server error response) THROWS so the IPC handler can
 * surface the error to the renderer.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  const token = getAuthToken()
  if (!token || !isAdmin()) return null
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
    console.error(`[mirror] ${method} ${path} failed:`, err)
    throw new Error(`Server rejected ${method} ${path}: ${err}`)
  }
  return data.data ?? null
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

function buildJobBody(row: JobRow): Record<string, unknown> {
  const connRemoteIds = (row.connection_ids ?? [])
    .map((cid) => remoteIdOf('connections', cid))
    .filter((x): x is string => !!x)
  return {
    name: row.name,
    description: row.description ?? null,
    job_group_id: remoteIdOf('job_groups', row.job_group_id),
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
    status: row.status ?? 'idle'
  }
}

export async function mirrorJobCreate(row: JobRow): Promise<void> {
  const created = await call<{ id: string }>('POST', '/jobs', buildJobBody(row))
  if (created?.id) saveRemoteId('jobs', row.id, created.id)
}

export async function mirrorJobUpdate(row: JobRow): Promise<void> {
  const rid = row.remote_id ?? remoteIdOf('jobs', row.id)
  if (!rid) {
    await mirrorJobCreate(row)
    return
  }
  await call('PATCH', `/jobs/${rid}`, buildJobBody(row))
}

export async function mirrorJobDelete(localId: number): Promise<void> {
  const rid = remoteIdOf('jobs', localId)
  if (!rid) return
  await call('DELETE', `/jobs/${rid}`)
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
