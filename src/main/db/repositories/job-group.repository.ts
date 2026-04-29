import db from '../index'
import type { JobGroupRow, CreateJobGroupDto, UpdateJobGroupDto } from '@shared/index'

export const jobGroupRepository = {
  findAll(): JobGroupRow[] {
    return db.prepare('SELECT * FROM job_groups ORDER BY name ASC').all() as JobGroupRow[]
  },

  findById(id: number): JobGroupRow | undefined {
    return db.prepare('SELECT * FROM job_groups WHERE id = ?').get(id) as JobGroupRow | undefined
  },

  create(data: CreateJobGroupDto): JobGroupRow {
    const result = db
      .prepare('INSERT INTO job_groups (name, description) VALUES (@name, @description)')
      .run(data)
    return this.findById(result.lastInsertRowid as number)!
  },

  update(id: number, data: UpdateJobGroupDto): JobGroupRow | undefined {
    db.prepare(
      `
      UPDATE job_groups SET
        name        = COALESCE(@name, name),
        description = COALESCE(@description, description),
        updated_at  = datetime('now')
      WHERE id = @id
    `
    ).run({ ...data, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM job_groups WHERE id = ?').run(id)
    return result.changes > 0
  },

  bulkCreate(items: CreateJobGroupDto[]): JobGroupRow[] {
    const stmt = db.prepare(
      'INSERT INTO job_groups (name, description) VALUES (@name, @description)'
    )
    const select = db.prepare('SELECT * FROM job_groups WHERE id = ?')
    const insertMany = db.transaction((rows: CreateJobGroupDto[]) => {
      const results: JobGroupRow[] = []
      for (const row of rows) {
        const result = stmt.run(row)
        results.push(select.get(result.lastInsertRowid) as JobGroupRow)
      }
      return results
    })
    return insertMany(items)
  },

  deleteAll(ids: number[]): void {
    const stmt = db.prepare('DELETE FROM job_groups WHERE id = ?')
    const deleteMany = db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id)
    })
    deleteMany(ids)
  }
}
