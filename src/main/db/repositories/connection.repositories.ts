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
    ).run({ ...data, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM connections WHERE id = ?').run(id)
    return result.changes > 0
  }
}
