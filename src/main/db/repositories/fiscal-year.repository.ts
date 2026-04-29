import db from '../index'
import type { FiscalYearRow, CreateFiscalYearDto, UpdateFiscalYearDto } from '@shared/index'

// ─── Repository ───────────────────────────────────────────────────────────────

export const fiscalYearRepository = {
  findAll(): FiscalYearRow[] {
    return db.prepare('SELECT * FROM fiscal_years ORDER BY name DESC').all() as FiscalYearRow[]
  },

  findById(id: number): FiscalYearRow | undefined {
    return db.prepare('SELECT * FROM fiscal_years WHERE id = ?').get(id) as
      | FiscalYearRow
      | undefined
  },

  create(data: CreateFiscalYearDto): FiscalYearRow {
    const result = db.prepare('INSERT INTO fiscal_years (name) VALUES (@name)').run(data)
    return this.findById(result.lastInsertRowid as number)!
  },

  bulkCreate(data: CreateFiscalYearDto[]): FiscalYearRow[] {
    const stmt = db.prepare('INSERT INTO fiscal_years (name) VALUES (@name)')
    const select = db.prepare('SELECT * FROM fiscal_years WHERE id = ?')

    const insertMany = db.transaction((items: CreateFiscalYearDto[]) => {
      const rows: FiscalYearRow[] = []

      for (const item of items) {
        const result = stmt.run(item)
        const created = select.get(result.lastInsertRowid) as FiscalYearRow
        if (created) rows.push(created)
      }

      return rows
    })

    return insertMany(data)
  },

  update(id: number, data: UpdateFiscalYearDto): FiscalYearRow | undefined {
    db.prepare(
      `
      UPDATE fiscal_years SET
        name       = COALESCE(@name, name),
        updated_at = datetime('now')
      WHERE id = @id
    `
    ).run({ ...data, id })
    return this.findById(id)
  },

  delete(id: number): boolean {
    const result = db.prepare('DELETE FROM fiscal_years WHERE id = ?').run(id)
    return result.changes > 0
  },

  deleteAll(ids: number[]): void {
    const stmt = db.prepare('DELETE FROM fiscal_years WHERE id = ?')
    const deleteMany = db.transaction((ids: number[]) => {
      for (const id of ids) {
        stmt.run(id)
      }
    })
    deleteMany(ids)
  }
}
