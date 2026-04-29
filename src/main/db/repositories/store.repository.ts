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
  },

  bulkCreate(items: CreateStoreDto[]): StoreRow[] {
    const stmt = db.prepare('INSERT INTO stores (name, code) VALUES (@name, @code)')
    const select = db.prepare('SELECT * FROM stores WHERE id = ?')
    const insertMany = db.transaction((rows: CreateStoreDto[]) => {
      const results: StoreRow[] = []
      for (const row of rows) {
        const result = stmt.run(row)
        const created = select.get(result.lastInsertRowid) as StoreRow
        if (created) results.push(created)
      }
      return results
    })
    return insertMany(items)
  },

  deleteAll(ids: number[]): void {
    const stmt = db.prepare('DELETE FROM stores WHERE id = ?')
    const deleteMany = db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id)
    })
    deleteMany(ids)
  }
}
