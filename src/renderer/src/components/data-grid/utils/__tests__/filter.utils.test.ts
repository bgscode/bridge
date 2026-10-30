import { describe, expect, it } from 'vitest'
import { applyFilterModel, getUniqueColumnValues } from '../filter.utils'

const rows = [
  { store: 'B', qty: 10 },
  { store: 'a', qty: 2 },
  { store: null, qty: 2 },
  { store: 'B', qty: 100 }
]

describe('Excel-style column filter', () => {
  it('lists distinct values sorted, numbers numerically, blanks last', () => {
    expect(getUniqueColumnValues(rows, 'store')).toEqual(['a', 'B', ''])
    expect(getUniqueColumnValues(rows, 'qty')).toEqual(['2', '10', '100'])
  })

  it('matches checked values (incl. blanks) and ANDs column filters', () => {
    const result = applyFilterModel(rows, {
      logic: 'and',
      rules: [
        { id: '1', columnId: 'store', operator: 'in', value: null, values: ['B', ''] },
        { id: '2', columnId: 'qty', operator: 'gt', value: 5 }
      ]
    })
    expect(result).toEqual([
      { store: 'B', qty: 10 },
      { store: 'B', qty: 100 }
    ])
  })
})
