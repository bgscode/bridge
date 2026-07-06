import type Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { mkdirSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { runMigrations } from './migrate'

let dbInstance: Database.Database | null = null
let dbInitError: Error | null = null

type BetterSqlite3Constructor = new (path: string) => Database.Database

function loadBetterSqlite3(): BetterSqlite3Constructor {
  // Defer native module load until after Electron is ready so packaged
  // Windows builds load the rebuilt .node binary from app.asar.unpacked.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('better-sqlite3') as BetterSqlite3Constructor
}

/**
 * Open the SQLite database, surviving common failure modes:
 *   - File-locked by another instance → surface a clear dialog and exit.
 *   - File-corrupted → quarantine the file (.corrupt-<ts>) so the next launch
 *     starts fresh; user can recover the old file from disk if needed.
 *   - Migration failure on a newly-opened DB → quarantine + retry once.
 */
function openDatabase(): Database.Database {
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'bridge-db')
  mkdirSync(dbDir, { recursive: true })
  const dbPath = join(dbDir, 'bridge.db')

  try {
    const BetterSqlite3 = loadBetterSqlite3()
    const handle = new BetterSqlite3(dbPath)
    handle.pragma('journal_mode = WAL')
    handle.pragma('foreign_keys = ON')
    runMigrations(handle)
    return handle
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[db] open failed:', msg)

    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(msg)) {
      try {
        dialog.showErrorBox(
          'Database is locked',
          'Another copy of Alam appears to be running and is using the database. Close it and try again.'
        )
      } catch {
        // dialog may not be available before app.whenReady; just log.
      }
      throw err
    }

    if (/SQLITE_CORRUPT|malformed|not a database/i.test(msg) && existsSync(dbPath)) {
      const quarantine = `${dbPath}.corrupt-${Date.now()}`
      try {
        renameSync(dbPath, quarantine)
        console.warn(`[db] corrupt file quarantined to ${quarantine}; rebuilding fresh database`)
        const BetterSqlite3 = loadBetterSqlite3()
        const handle = new BetterSqlite3(dbPath)
        handle.pragma('journal_mode = WAL')
        handle.pragma('foreign_keys = ON')
        runMigrations(handle)
        return handle
      } catch (recoveryErr) {
        console.error('[db] recovery after corruption failed:', recoveryErr)
        throw recoveryErr
      }
    }

    throw err
  }
}

function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance
  if (dbInitError) throw dbInitError

  try {
    dbInstance = openDatabase()
    return dbInstance
  } catch (err) {
    dbInitError = err instanceof Error ? err : new Error(String(err))
    throw dbInitError
  }
}

const db = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    const instance = getDatabase()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  }
})

export default db
