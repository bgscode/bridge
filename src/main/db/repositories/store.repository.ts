import db from '../index'
import type { StoreRow, CreateStoreDto, UpdateStoreDto } from '@shared/index'

// ─── Repository ───────────────────────────────────────────────────────────────

export const storeRepository = {
  findAll(): StoreRow[] {
    return db.prepare('SELECT * FROM stores ORDER BY name ASC').all() as StoreRow[]
  },

  findById(id: number): StoreRow | undefined {
    return db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as StoreRow | undefined
  },

  create(data: CreateStoreDto): StoreRow {
    const result = db.prepare('INSERT INTO stores (name, code) VALUES (@name, @code)').run(data)
    return this.findById(result.lastInsertRowid as number)!
  },

  update(id: number, data: UpdateStoreDto): StoreRow | undefined {
    db.prepare(
      `
      UPDATE stores SET
        name       = COALESCE(@name, name),
        code       = COALESCE(@code, code),
        updated_at = datetime('now')
      WHERE id = @id
    `
    ).run({ ...data, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM stores WHERE id = ?').run(id)
    return result.changes > 0
  }
}
