export type ActionWriteMode = 'insert' | 'update' | 'upsert'

export interface ActionBatchPlan {
  sql: string
  params: Record<string, unknown>
}

interface BuildActionBatchPlanInput {
  mode: ActionWriteMode
  table: string
  keyColumns: string[]
  rows: Record<string, unknown>[]
}

function assertIdentifierPart(part: string, fieldName: string): string {
  const trimmed = part.trim()
  if (!trimmed) {
    throw new Error(`${fieldName} cannot be empty`)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid SQL identifier: ${trimmed}`)
  }
  return trimmed
}

function quoteIdentifier(identifier: string): string {
  return `[${identifier}]`
}

function quoteTableName(table: string): string {
  const parts = table
    .split('.')
    .map((part, idx) => assertIdentifierPart(part, `table part ${idx + 1}`))
  return parts.map(quoteIdentifier).join('.')
}

function normalizeColumns(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const safe = assertIdentifierPart(key, 'column')
      if (!seen.has(safe)) {
        seen.add(safe)
        out.push(safe)
      }
    }
  }
  return out
}

function buildValuesAndParams(
  rows: Record<string, unknown>[],
  columns: string[]
): { valuesSql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {}
  const tuples: string[] = []

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const refs: string[] = []

    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      const col = columns[colIndex]
      const paramName = `p_${rowIndex}_${colIndex}`
      params[paramName] = row[col] ?? null
      refs.push(`@${paramName}`)
    }

    tuples.push(`(${refs.join(', ')})`)
  }

  return {
    valuesSql: tuples.join(',\n'),
    params
  }
}

export function buildActionBatchPlan(input: BuildActionBatchPlanInput): ActionBatchPlan {
  const rows = input.rows
  if (rows.length === 0) {
    throw new Error('Cannot build batch plan for empty row set')
  }

  const tableSql = quoteTableName(input.table)
  const columns = normalizeColumns(rows)
  if (columns.length === 0) {
    throw new Error('No columns found in batch rows')
  }

  const keyColumns = input.keyColumns.map((col) => assertIdentifierPart(col, 'key column'))
  if ((input.mode === 'update' || input.mode === 'upsert') && keyColumns.length === 0) {
    throw new Error('At least one key column is required for update/upsert')
  }

  for (const key of keyColumns) {
    if (!columns.includes(key)) {
      throw new Error(`Key column "${key}" not found in batch data`)
    }
  }

  const nonKeyColumns = columns.filter((col) => !keyColumns.includes(col))
  const quotedColumns = columns.map(quoteIdentifier)
  const { valuesSql, params } = buildValuesAndParams(rows, columns)

  if (input.mode === 'insert') {
    const insertSql = `
INSERT INTO ${tableSql} (${quotedColumns.join(', ')})
VALUES
${valuesSql};
`.trim()
    return { sql: insertSql, params }
  }

  const sourceColsSql = quotedColumns.join(', ')
  const onSql = keyColumns
    .map((key) => `target.${quoteIdentifier(key)} = source.${quoteIdentifier(key)}`)
    .join(' AND ')

  const clauses: string[] = []
  if (nonKeyColumns.length > 0) {
    const setSql = nonKeyColumns
      .map((col) => `target.${quoteIdentifier(col)} = source.${quoteIdentifier(col)}`)
      .join(', ')
    clauses.push(`WHEN MATCHED THEN\n  UPDATE SET ${setSql}`)
  }

  if (input.mode === 'upsert') {
    clauses.push(
      `WHEN NOT MATCHED THEN\n  INSERT (${quotedColumns.join(', ')})\n  VALUES (${columns.map((col) => `source.${quoteIdentifier(col)}`).join(', ')})`
    )
  }

  if (clauses.length === 0) {
    throw new Error('No write clause generated for batch plan')
  }

  const mergeSql = `
MERGE ${tableSql} AS target
USING (
  VALUES
  ${valuesSql}
) AS source (${sourceColsSql})
ON ${onSql}
${clauses.join('\n')};
`.trim()

  return { sql: mergeSql, params }
}
