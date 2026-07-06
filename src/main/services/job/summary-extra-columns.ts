import type { ConnectionRow, JobProgress } from '@shared/index'
import { fiscalYearRepository } from '../../db/repositories/fiscal-year.repository'
import { groupRepository } from '../../db/repositories/group.repository'
import { storeRepository } from '../../db/repositories/store.repository'
import { formatUtcToIst } from '../../utils/format-date'

const COLUMN_LABELS: Record<string, string> = {
  group_name: 'Group',
  store_name: 'Store',
  fiscal_year_name: 'Fiscal Year',
  static_ip: 'Static IP',
  vpn_ip: 'VPN IP',
  db_name: 'Database',
  row_count: 'Row Count',
  run_timestamp: 'Timestamp'
}

export interface SummaryExtraColumnResolver {
  keys: string[]
  labels: string[]
  getValues(connectionId: number): string[]
}

export function labelForSummaryExtraColumn(key: string): string {
  return COLUMN_LABELS[key] ?? key
}

export function createSummaryExtraColumnResolver(args: {
  keys: string[]
  connections: ConnectionRow[]
  progress?: JobProgress
  rowCountByConnectionId?: Map<number, number>
}): SummaryExtraColumnResolver {
  const keys = args.keys.filter(Boolean)
  const needsGroupLookup = keys.includes('group_name')
  const needsStoreLookup = keys.includes('store_name')
  const needsFiscalLookup = keys.includes('fiscal_year_name')
  const needsProgress = keys.includes('row_count') || keys.includes('run_timestamp')

  const groupMap = new Map<number, string>()
  const storeMap = new Map<number, string>()
  const fiscalYearMap = new Map<number, string>()
  const progressByConnectionId = new Map<number, JobProgress['connections'][number]>()

  if (needsGroupLookup) {
    for (const group of groupRepository.findAll()) groupMap.set(group.id, group.name)
  }
  if (needsStoreLookup) {
    for (const store of storeRepository.findAll()) storeMap.set(store.id, store.name)
  }
  if (needsFiscalLookup) {
    for (const fiscalYear of fiscalYearRepository.findAll()) {
      fiscalYearMap.set(fiscalYear.id, fiscalYear.name)
    }
  }
  if (needsProgress && args.progress) {
    for (const conn of args.progress.connections) {
      progressByConnectionId.set(conn.connection_id, conn)
    }
  }

  function resolveValue(key: string, conn: ConnectionRow): string {
    switch (key) {
      case 'group_name':
        return conn.group_id ? (groupMap.get(conn.group_id) ?? '') : ''
      case 'store_name':
        return conn.store_id ? (storeMap.get(conn.store_id) ?? '') : ''
      case 'fiscal_year_name':
        return conn.fiscal_year_id ? (fiscalYearMap.get(conn.fiscal_year_id) ?? '') : ''
      case 'static_ip':
        return conn.static_ip ?? ''
      case 'vpn_ip':
        return conn.vpn_ip ?? ''
      case 'db_name':
        return conn.db_name ?? ''
      case 'row_count': {
        const fromMap = args.rowCountByConnectionId?.get(conn.id)
        if (fromMap != null) return String(fromMap)
        const progressConn = progressByConnectionId.get(conn.id)
        return progressConn ? String(progressConn.rows) : ''
      }
      case 'run_timestamp': {
        const progressConn = progressByConnectionId.get(conn.id)
        const timestamp = progressConn?.finished_at ?? progressConn?.started_at ?? null
        return timestamp ? formatUtcToIst(timestamp) : ''
      }
      default:
        return ''
    }
  }

  return {
    keys,
    labels: keys.map((key) => labelForSummaryExtraColumn(key)),
    getValues(connectionId: number): string[] {
      const conn = args.connections.find((connection) => connection.id === connectionId)
      if (!conn || keys.length === 0) return []
      return keys.map((key) => resolveValue(key, conn))
    }
  }
}
