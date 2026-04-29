import db from '../index'
import type { AppSettings, SettingRow } from '@shared/index'
import { DEFAULT_SETTINGS as DEFAULTS } from '@shared/index'

function parseValue(key: keyof AppSettings, raw: string): AppSettings[keyof AppSettings] {
  if (
    key === 'monitor_startup_test' ||
    key === 'monitor_enabled' ||
    key === 'excel_create_empty_sheets'
  ) {
    return raw === 'true'
  }
  if (key === 'excel_sheet_name_source') {
    return (
      raw === 'store_name' || raw === 'store_code' ? raw : 'connection_name'
    ) as AppSettings['excel_sheet_name_source']
  }
  return Number(raw)
}

export const settingsRepo = {
  getAll(): AppSettings {
    const rows = db.prepare('SELECT key, value FROM settings').all() as SettingRow[]
    const result = { ...DEFAULTS }
    for (const row of rows) {
      const key = row.key as keyof AppSettings
      if (key in result) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(result as any)[key] = parseValue(key, row.value)
      }
    }
    return result
  },

  setMany(data: Partial<AppSettings>): AppSettings {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const runMany = db.transaction((entries: [string, string][]) => {
      for (const [k, v] of entries) stmt.run(k, v)
    })
    const entries = Object.entries(data).map(([k, v]) => [k, String(v)] as [string, string])
    runMany(entries)
    return this.getAll()
  }
}
