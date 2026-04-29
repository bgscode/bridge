/**
 * Output Decision Engine — picks the right output format for a job based on
 * estimated data size, connection pressure, and current system memory.
 *
 * Rules (from systemimplimation.md):
 *   if (memory > 75%)              → csv
 *   if (totalRows > 300k)          → csv
 *   if (sizeMB > 100)              → csv
 *   if (pressure > 3 and dataset large) → csv
 *   if (totalRows < 100k)          → excel
 *   if (totalRows < 300k)          → excel-stream
 *   else                           → csv
 */

export type OutputFormat = 'excel' | 'excel-stream' | 'csv'

export interface OutputDecisionInput {
  /** Estimated total rows across all connections */
  totalRows: number
  /** Estimated average row size in bytes (default 256) */
  avgRowBytes?: number
  /** Number of connections in the job */
  connectionCount: number
  /** Max parallel connections configured */
  maxParallel: number
  /** System memory usage 0..1 (from Adaptive Brain) */
  memoryUsage: number
  /** Preferred format (user-selected); respected if compatible */
  preferred?: OutputFormat | 'auto'
}

export interface OutputDecision {
  format: OutputFormat
  reason: string
  sizeMB: number
  pressure: number
  /** true if the decision diverges from the user's preferred format */
  downgraded: boolean
}

export function decideOutputFormat(input: OutputDecisionInput): OutputDecision {
  const avgRowBytes = input.avgRowBytes ?? 256
  const sizeMB = (input.totalRows * avgRowBytes) / (1024 * 1024)
  const pressure = input.maxParallel > 0 ? input.connectionCount / input.maxParallel : 0
  const preferred = input.preferred ?? 'auto'

  const chosen = pickFormat(input.totalRows, sizeMB, pressure, input.memoryUsage)

  let format: OutputFormat = chosen.format
  let reason = chosen.reason
  let downgraded = false

  // Respect user preference only when safe.
  if (preferred !== 'auto' && preferred !== format) {
    if (preferred === 'excel' && format === 'excel-stream') {
      // user asked for plain excel but data suggests streaming — honor streaming (safer).
      downgraded = true
      reason += ' (user asked excel, forced streaming for safety)'
    } else if (preferred === 'excel' && format === 'csv') {
      downgraded = true
      reason += ' (user asked excel, forced CSV for safety)'
    } else if (preferred === 'excel-stream' && format === 'csv') {
      downgraded = true
      reason += ' (user asked excel-stream, forced CSV for safety)'
    } else if (preferred === 'csv') {
      // user explicitly wants csv — always honor
      format = 'csv'
      reason = 'user preferred csv'
    }
  }

  return { format, reason, sizeMB, pressure, downgraded }
}

function pickFormat(
  totalRows: number,
  sizeMB: number,
  pressure: number,
  memoryUsage: number
): { format: OutputFormat; reason: string } {
  if (memoryUsage > 0.75) {
    return { format: 'csv', reason: `memory ${(memoryUsage * 100).toFixed(0)}% > 75%` }
  }
  if (totalRows > 300_000) {
    return { format: 'csv', reason: `rows ${totalRows.toLocaleString()} > 300k` }
  }
  if (sizeMB > 100) {
    return { format: 'csv', reason: `size ${sizeMB.toFixed(1)}MB > 100MB` }
  }
  if (pressure > 3) {
    // Pressure alone should not force CSV for tiny result sets.
    if (totalRows > 100_000 || sizeMB > 40 || memoryUsage > 0.65) {
      return {
        format: 'csv',
        reason: `pressure ${pressure.toFixed(1)} > 3 with large dataset (${totalRows.toLocaleString()} rows)`
      }
    }

    return {
      format: 'excel-stream',
      reason: `pressure ${pressure.toFixed(1)} > 3 but dataset is small (${totalRows.toLocaleString()} rows)`
    }
  }
  if (totalRows < 100_000) {
    return { format: 'excel', reason: `small dataset (${totalRows.toLocaleString()} rows)` }
  }
  if (totalRows < 300_000) {
    return { format: 'excel-stream', reason: `medium dataset (${totalRows.toLocaleString()} rows)` }
  }
  return { format: 'csv', reason: 'large dataset fallback' }
}
