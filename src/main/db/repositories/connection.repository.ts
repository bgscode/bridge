import db from '../index'
import type { ConnectionRow, CreateConnectionDto, UpdateConnectionDto } from '@shared/index'

// ─── Repository ───────────────────────────────────────────────────────────────

export const connection = {
  findAll(): ConnectionRow[] {
    return db.prepare('SELECT * FROM connections ORDER BY created_at DESC').all() as ConnectionRow[]
  },

  findById(id: number): ConnectionRow | undefined {
    return db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow | undefined
  },

  create(data: CreateConnectionDto): ConnectionRow {
    const result = db
      .prepare(
        `
        INSERT INTO connections
          (name, group_id, static_ip, vpn_ip, db_name, username, password,
           trust_cert, fiscal_year_id, store_id, status)
        VALUES
          (@name, @group_id, @static_ip, @vpn_ip, @db_name, @username, @password,
           @trust_cert, @fiscal_year_id, @store_id, @status)
      `
      )
      .run(data)
    return this.findById(result.lastInsertRowid as number)!
  },

  update(id: number, data: UpdateConnectionDto): ConnectionRow | undefined {
    db.prepare(
      `
      UPDATE connections SET
        name           = COALESCE(@name, name),
        group_id       = COALESCE(@group_id, group_id),
        static_ip      = COALESCE(@static_ip, static_ip),
        vpn_ip         = COALESCE(@vpn_ip, vpn_ip),
        db_name        = COALESCE(@db_name, db_name),
        username       = COALESCE(@username, username),
        password       = COALESCE(@password, password),
        trust_cert     = COALESCE(@trust_cert, trust_cert),
        fiscal_year_id = COALESCE(@fiscal_year_id, fiscal_year_id),
        store_id       = COALESCE(@store_id, store_id),
        status         = COALESCE(@status, status),
        updated_at     = datetime('now')
      WHERE id = @id
    `
    ).run({
      name: undefined,
      group_id: undefined,
      static_ip: undefined,
      vpn_ip: undefined,
      db_name: undefined,
      username: undefined,
      password: undefined,
      trust_cert: undefined,
      fiscal_year_id: undefined,
      store_id: undefined,
      status: undefined,
      ...data,
      id
    })
    return this.findById(id)
  },

  bulkCreate(items: CreateConnectionDto[]): ConnectionRow[] {
    const stmt = db.prepare(`
      INSERT INTO connections
        (name, group_id, static_ip, vpn_ip, db_name, username, password,
         trust_cert, fiscal_year_id, store_id, status)
      VALUES
        (@name, @group_id, @static_ip, @vpn_ip, @db_name, @username, @password,
         @trust_cert, @fiscal_year_id, @store_id, @status)
    `)
    const select = db.prepare('SELECT * FROM connections WHERE id = ?')
    const insertMany = db.transaction((rows: CreateConnectionDto[]) => {
      const results: ConnectionRow[] = []
      for (const row of rows) {
        const result = stmt.run(row)
        const created = select.get(result.lastInsertRowid) as ConnectionRow
        if (created) results.push(created)
      }
      return results
    })
    return insertMany(items)
  },

  /**
   * Apply the same username/password to many connections atomically. Either
   * field may be omitted to leave it untouched. Returns the updated rows.
   */
  bulkUpdateCredentials(
    ids: number[],
    creds: { username?: string; password?: string }
  ): ConnectionRow[] {
    if (ids.length === 0) return []
    const stmt = db.prepare(
      `UPDATE connections SET
         username   = COALESCE(@username, username),
         password   = COALESCE(@password, password),
         updated_at = datetime('now')
       WHERE id = @id`
    )
    const select = db.prepare('SELECT * FROM connections WHERE id = ?')
    const apply = db.transaction((targetIds: number[]) => {
      const out: ConnectionRow[] = []
      for (const id of targetIds) {
        stmt.run({
          username: creds.username ?? null,
          password: creds.password ?? null,
          id
        })
        const row = select.get(id) as ConnectionRow | undefined
        if (row) out.push(row)
      }
      return out
    })
    return apply(ids)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM connections WHERE id = ?').run(id)
    return result.changes > 0
  },

  deleteAll(ids: number[]): number {
    const stmt = db.prepare(`DELETE FROM connections WHERE id = ?`)
    const deleteMany = db.transaction((ids: number[]) => {
      let totalDeleted = 0
      for (const id of ids) {
        const result = stmt.run(id)
        totalDeleted += result.changes
      }
      return totalDeleted
    })
    return deleteMany(ids)
  }
}
