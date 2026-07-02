import db from '../index'
import {
  JobVariable,
  JobVariableValue,
  CreateJobVariableDto,
  UpdateJobVariableDto
} from '@shared/index'

// ─── Raw DB row types ─────────────────────────────────────────────────────────

interface RawJobVariable {
  id: number
  job_id: number
  remote_id: string | null
  name: string
  description: string | null
  default_value: string | null
  auto_update: number
  source_column: string | null
  update_fn: string
  created_at: string
  updated_at: string
}

interface RawJobVariableValue {
  id: number
  job_variable_id: number
  connection_id: number
  value: string | null
  last_run_at: string | null
  updated_at: string
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseVariable(raw: RawJobVariable, values: JobVariableValue[] = []): JobVariable {
  return {
    id: raw.id,
    job_id: raw.job_id,
    remote_id: raw.remote_id,
    name: raw.name,
    description: raw.description,
    default_value: raw.default_value,
    auto_update: Boolean(raw.auto_update),
    source_column: raw.source_column,
    update_fn: (raw.update_fn as 'max' | 'min' | 'last') ?? 'max',
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    values
  }
}

function parseValue(raw: RawJobVariableValue): JobVariableValue {
  return {
    id: raw.id,
    job_variable_id: raw.job_variable_id,
    connection_id: raw.connection_id,
    value: raw.value,
    last_run_at: raw.last_run_at,
    updated_at: raw.updated_at
  }
}

// ─── Repository ───────────────────────────────────────────────────────────────

export const jobVariableRepository = {
  /** Return all variables for a job, with their per-connection values joined in. */
  findByJob(jobId: number): JobVariable[] {
    const rawVars = db
      .prepare('SELECT * FROM job_variables WHERE job_id = ? ORDER BY created_at ASC')
      .all(jobId) as RawJobVariable[]

    if (rawVars.length === 0) return []

    const ids = rawVars.map((v) => v.id)
    const placeholders = ids.map(() => '?').join(',')
    const rawValues = db
      .prepare(
        `SELECT * FROM job_variable_values WHERE job_variable_id IN (${placeholders}) ORDER BY updated_at DESC`
      )
      .all(...ids) as RawJobVariableValue[]

    const valuesByVarId = new Map<number, JobVariableValue[]>()
    for (const rv of rawValues) {
      const pv = parseValue(rv)
      const arr = valuesByVarId.get(pv.job_variable_id) ?? []
      arr.push(pv)
      valuesByVarId.set(pv.job_variable_id, arr)
    }

    return rawVars.map((rv) => parseVariable(rv, valuesByVarId.get(rv.id) ?? []))
  },

  findById(id: number): JobVariable | undefined {
    const raw = db.prepare('SELECT * FROM job_variables WHERE id = ?').get(id) as
      | RawJobVariable
      | undefined
    if (!raw) return undefined

    const rawValues = db
      .prepare('SELECT * FROM job_variable_values WHERE job_variable_id = ?')
      .all(id) as RawJobVariableValue[]

    return parseVariable(raw, rawValues.map(parseValue))
  },

  create(dto: CreateJobVariableDto): JobVariable {
    const stmt = db.prepare(`
      INSERT INTO job_variables (job_id, remote_id, name, description, default_value, auto_update, source_column, update_fn)
      VALUES (@job_id, @remote_id, @name, @description, @default_value, @auto_update, @source_column, @update_fn)
    `)
    const result = stmt.run({
      job_id: dto.job_id,
      remote_id: dto.remote_id ?? null,
      name: dto.name.trim(),
      description: dto.description ?? null,
      default_value: dto.default_value ?? null,
      auto_update: dto.auto_update ? 1 : 0,
      source_column: dto.source_column ?? null,
      update_fn: dto.update_fn ?? 'max'
    })
    return this.findById(result.lastInsertRowid as number)!
  },

  update(id: number, dto: UpdateJobVariableDto): JobVariable | undefined {
    const updates: string[] = []
    const params: Record<string, unknown> = { id }

    if (dto.name !== undefined) {
      updates.push('name = @name')
      params.name = dto.name.trim()
    }
    if ('description' in dto) {
      updates.push('description = @description')
      params.description = dto.description ?? null
    }
    if ('default_value' in dto) {
      updates.push('default_value = @default_value')
      params.default_value = dto.default_value ?? null
    }
    if (dto.auto_update !== undefined) {
      updates.push('auto_update = @auto_update')
      params.auto_update = dto.auto_update ? 1 : 0
    }
    if ('source_column' in dto) {
      updates.push('source_column = @source_column')
      params.source_column = dto.source_column ?? null
    }
    if (dto.update_fn !== undefined) {
      updates.push('update_fn = @update_fn')
      params.update_fn = dto.update_fn
    }

    if (updates.length === 0) return this.findById(id)

    updates.push("updated_at = datetime('now')")
    db.prepare(`UPDATE job_variables SET ${updates.join(', ')} WHERE id = @id`).run(params)
    return this.findById(id)
  },

  delete(id: number): void {
    db.prepare('DELETE FROM job_variables WHERE id = ?').run(id)
  },

  /**
   * Get per-connection variable values for a job, ready for query injection.
   * Returns: Map<connectionId, Record<varName, effectiveValue>>
   * effectiveValue = stored value ?? default_value ?? ''
   */
  getValueMapForJob(jobId: number): Map<number, Record<string, string>> {
    const variables = this.findByJob(jobId)
    const result = new Map<number, Record<string, string>>()

    for (const variable of variables) {
      for (const val of variable.values) {
        const map = result.get(val.connection_id) ?? {}
        map[variable.name] = val.value ?? variable.default_value ?? ''
        result.set(val.connection_id, map)
      }
    }

    // Ensure every variable has an entry with its default for connections
    // that have never run (no stored value yet).
    // This is done at call-site via injectVariables using defaultValue fallback.
    return result
  },

  /**
   * Returns all variables for a job as a flat lookup:
   * { varName → { id, defaultValue, autoUpdate, sourceColumn, updateFn } }
   */
  getVariableMetaForJob(jobId: number): Map<
    string,
    {
      id: number
      defaultValue: string | null
      autoUpdate: boolean
      sourceColumn: string | null
      updateFn: 'max' | 'min' | 'last'
    }
  > {
    const variables = this.findByJob(jobId)
    const meta = new Map<
      string,
      {
        id: number
        defaultValue: string | null
        autoUpdate: boolean
        sourceColumn: string | null
        updateFn: 'max' | 'min' | 'last'
      }
    >()
    for (const v of variables) {
      meta.set(v.name, {
        id: v.id,
        defaultValue: v.default_value,
        autoUpdate: v.auto_update,
        sourceColumn: v.source_column,
        updateFn: v.update_fn
      })
    }
    return meta
  },

  /**
   * Get the stored value for a single variable + connection.
   * Returns null when no value has been saved yet.
   */
  getValue(jobVariableId: number, connectionId: number): string | null {
    const raw = db
      .prepare(
        'SELECT value FROM job_variable_values WHERE job_variable_id = ? AND connection_id = ?'
      )
      .get(jobVariableId, connectionId) as { value: string | null } | undefined
    return raw?.value ?? null
  },

  /** Create or update the checkpoint value for a variable + connection. */
  upsertValue(jobVariableId: number, connectionId: number, value: string): void {
    db.prepare(
      `
      INSERT INTO job_variable_values (job_variable_id, connection_id, value, last_run_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(job_variable_id, connection_id)
      DO UPDATE SET value = excluded.value,
                    last_run_at = excluded.last_run_at,
                    updated_at = excluded.updated_at
    `
    ).run(jobVariableId, connectionId, value)
  },

  /** Manually set a value from the UI (same upsert, different intent). */
  setValue(jobVariableId: number, connectionId: number, value: string): void {
    this.upsertValue(jobVariableId, connectionId, value)
  },

  /**
   * Set one value for the entire job — updates default_value and every connection
   * on the job so manual edits are not done one connection at a time.
   */
  setJobWideValue(jobVariableId: number, connectionIds: number[], value: string): void {
    db.prepare(
      `UPDATE job_variables SET default_value = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(value, jobVariableId)

    const uniqueConnectionIds = Array.from(new Set(connectionIds))
    for (const connectionId of uniqueConnectionIds) {
      this.upsertValue(jobVariableId, connectionId, value)
    }
  },

  /** Remove all stored values for a specific connection across a job's variables. */
  deleteConnectionValues(jobId: number, connectionId: number): void {
    db.prepare(
      `
      DELETE FROM job_variable_values
      WHERE connection_id = ?
        AND job_variable_id IN (SELECT id FROM job_variables WHERE job_id = ?)
    `
    ).run(connectionId, jobId)
  }
}
