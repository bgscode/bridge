import db from '../index'
import type { GroupRow, CreateGroupDto, UpdateGroupDto } from '@shared/index'

// ─── Repository ───────────────────────────────────────────────────────────────

export const groupRepository = {
  findAll(): GroupRow[] {
    return db.prepare('SELECT * FROM groups ORDER BY name ASC').all() as GroupRow[]
  },

  findById(id: number): GroupRow | undefined {
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined
  },

  create(data: CreateGroupDto): GroupRow {
    const result = db
      .prepare('INSERT INTO groups (name, description) VALUES (@name, @description)')
      .run(data)
    return this.findById(result.lastInsertRowid as number)!
  },

  update(id: number, data: UpdateGroupDto): GroupRow | undefined {
    db.prepare(
      `
      UPDATE groups SET
        name        = COALESCE(@name, name),
        description = COALESCE(@description, description),
        updated_at  = datetime('now')
      WHERE id = @id
    `
    ).run({ ...data, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM groups WHERE id = ?').run(id)
    return result.changes > 0
  },

  bulkCreate(items: CreateGroupDto[]): GroupRow[] {
    const stmt = db.prepare('INSERT INTO groups (name, description) VALUES (@name, @description)')
    const select = db.prepare('SELECT * FROM groups WHERE id = ?')
    const insertMany = db.transaction((rows: CreateGroupDto[]) => {
      const results: GroupRow[] = []
      for (const row of rows) {
        const result = stmt.run(row)
        results.push(select.get(result.lastInsertRowid) as GroupRow)
      }
      return results
    })
    return insertMany(items)
  },

  deleteAll(ids: number[]): void {
    const stmt = db.prepare('DELETE FROM groups WHERE id = ?')
    const deleteMany = db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id)
    })
    deleteMany(ids)
  }
}
