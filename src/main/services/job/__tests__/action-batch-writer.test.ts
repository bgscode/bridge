import { describe, expect, it } from 'vitest'
import { buildActionBatchPlan } from '../action-batch-writer'

describe('buildActionBatchPlan', () => {
  it('builds INSERT statement with parameterized values', () => {
    const plan = buildActionBatchPlan({
      mode: 'insert',
      table: 'dbo.products',
      keyColumns: ['id'],
      rows: [
        { id: 1, price: 10 },
        { id: 2, price: 20 }
      ]
    })

    expect(plan.sql).toMatch(/INSERT INTO \[dbo\]\.\[products\]/)
    expect(plan.sql).toMatch(/VALUES/)
    expect(Object.keys(plan.params)).toHaveLength(4)
  })

  it('builds UPSERT MERGE statement with keys', () => {
    const plan = buildActionBatchPlan({
      mode: 'upsert',
      table: 'dbo.products',
      keyColumns: ['id'],
      rows: [{ id: 1, price: 10 }]
    })

    expect(plan.sql).toMatch(/^MERGE /)
    expect(plan.sql).toMatch(/WHEN MATCHED THEN/)
    expect(plan.sql).toMatch(/WHEN NOT MATCHED THEN/)
    expect(plan.sql).toMatch(/ON target\.\[id\] = source\.\[id\]/)
  })

  it('builds UPDATE MERGE without insert clause', () => {
    const plan = buildActionBatchPlan({
      mode: 'update',
      table: 'dbo.products',
      keyColumns: ['id'],
      rows: [{ id: 1, price: 99 }]
    })

    expect(plan.sql).toMatch(/^MERGE /)
    expect(plan.sql).toMatch(/WHEN MATCHED THEN/)
    expect(plan.sql).not.toMatch(/WHEN NOT MATCHED THEN/)
  })

  it('throws when key column missing in batch rows', () => {
    expect(() =>
      buildActionBatchPlan({
        mode: 'upsert',
        table: 'dbo.products',
        keyColumns: ['product_id'],
        rows: [{ id: 1, price: 10 }]
      })
    ).toThrow(/Key column/)
  })

  it('rejects unsafe identifiers', () => {
    expect(() =>
      buildActionBatchPlan({
        mode: 'insert',
        table: 'dbo.products; DROP TABLE x',
        keyColumns: ['id'],
        rows: [{ id: 1 }]
      })
    ).toThrow(/Invalid SQL identifier/)
  })
})
