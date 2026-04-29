import db from '../index'
import { CreateJobDto, JobRow, UpdateJobDto } from '@shared/index'

// ─── Serialization helpers ────────────────────────────────────────────────────
// SQLite stores TEXT + INTEGER. TypeScript uses arrays + booleans.
// All conversion happens here — the rest of the app works with clean native types.

/** DB row shape before parsing (everything is TEXT/INTEGER) */
interface RawJobRow extends Omit<
  JobRow,
  'connection_ids' | 'sql_query' | 'sql_query_names' | 'is_multi' | 'online_only'
> {
  connection_ids: string
  sql_query: string
  sql_query_names: string
  is_multi: number
  online_only: number
}

function parseRow(raw: RawJobRow): JobRow {
  return {
    ...raw,
    connection_ids: JSON.parse(raw.connection_ids || '[]'),
    sql_query: JSON.parse(raw.sql_query || '[]'),
    sql_query_names: JSON.parse(raw.sql_query_names || '[]'),
    is_multi: Boolean(raw.is_multi),
    online_only: Boolean(raw.online_only)
  }
}

function serializeForInsert(data: CreateJobDto): Record<string, unknown> {
  return {
    name: data.name,
    description: data.description ?? null,
    job_group_id: data.job_group_id ?? null,
    connection_ids: JSON.stringify(data.connection_ids ?? []),
    online_only: data.online_only ? 1 : 0,
    is_multi: data.is_multi ? 1 : 0,
    type: data.type,
    sql_query: JSON.stringify(data.sql_query ?? []),
    sql_query_names: JSON.stringify(data.sql_query_names ?? []),
    destination_type: data.destination_type ?? null,
    destination_config: data.destination_config ?? null,
    operation: data.operation ?? null,
    notify_webhook: data.notify_webhook ?? null,
    template_path: data.template_path ?? null,
    template_mode: data.template_mode ?? null,
    schedule: data.schedule ?? null
  }
}

/** Only these keys are real DB columns — anything else is silently ignored */
const KNOWN_COLUMNS = new Set([
  'name',
  'description',
  'job_group_id',
  'connection_ids',
  'online_only',
  'is_multi',
  'type',
  'sql_query',
  'sql_query_names',
  'destination_type',
  'destination_config',
  'operation',
  'notify_webhook',
  'template_path',
  'template_mode',
  'schedule',
  'status',
  'last_run_at',
  'last_error'
])

function serializeForUpdate(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (!KNOWN_COLUMNS.has(key)) continue
    if (key === 'connection_ids') {
      out[key] = JSON.stringify(value)
    } else if (key === 'sql_query' || key === 'sql_query_names') {
      out[key] = JSON.stringify(value)
    } else if (key === 'is_multi' || key === 'online_only') {
      out[key] = value ? 1 : 0
    } else {
      out[key] = value ?? null
    }
  }
  return out
}

// ─── Repository ───────────────────────────────────────────────────────────────

export const jobRepository = {
  findAll(): JobRow[] {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY name ASC').all() as RawJobRow[]
    return rows.map(parseRow)
  },

  findById(id: number): JobRow | undefined {
    const raw = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as RawJobRow | undefined
    return raw ? parseRow(raw) : undefined
  },

  create(data: CreateJobDto): JobRow {
    const serialized = serializeForInsert(data)
    const result = db
      .prepare(
        'INSERT INTO jobs (name, description, job_group_id, connection_ids, online_only, is_multi, type, sql_query, sql_query_names, destination_type, destination_config, operation, notify_webhook, template_path, template_mode, schedule) VALUES (@name, @description, @job_group_id, @connection_ids, @online_only, @is_multi, @type, @sql_query, @sql_query_names, @destination_type, @destination_config, @operation, @notify_webhook, @template_path, @template_mode, @schedule)'
      )
      .run(serialized)
    return this.findById(result.lastInsertRowid as number)!
  },

  bulkCreate(data: CreateJobDto[]): JobRow[] {
    const stmt = db.prepare(
      'INSERT INTO jobs (name, description, job_group_id, connection_ids, online_only, is_multi, type, sql_query, sql_query_names, destination_type, destination_config, operation, notify_webhook, template_path, template_mode, schedule) VALUES (@name, @description, @job_group_id, @connection_ids, @online_only, @is_multi, @type, @sql_query, @sql_query_names, @destination_type, @destination_config, @operation, @notify_webhook, @template_path, @template_mode, @schedule)'
    )
    const insertMany = db.transaction((jobs: CreateJobDto[]) => {
      const rows: JobRow[] = []
      for (const job of jobs) {
        const result = stmt.run(serializeForInsert(job))
        rows.push(this.findById(result.lastInsertRowid as number)!)
      }
      return rows
    })
    return insertMany(data)
  },

  update(id: number, data: UpdateJobDto): JobRow | undefined {
    const serialized = serializeForUpdate(data)
    const setClauses = Object.keys(serialized)
      .map((key) => `${key} = @${key}`)
      .join(', ')
    if (!setClauses) return this.findById(id)
    db.prepare(`UPDATE jobs SET ${setClauses} WHERE id = @id`).run({ ...serialized, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
    return result.changes > 0
  },

  deleteAll(ids: number[]): void {
    const stmt = db.prepare('DELETE FROM jobs WHERE id = ?')
    const deleteMany = db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id)
    })
    deleteMany(ids)
  }
}
