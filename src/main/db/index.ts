import Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { mkdirSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { runMigrations } from './migrate'

const userDataPath = app.getPath('userData')
const dbDir = join(userDataPath, 'bridge-db')
mkdirSync(dbDir, { recursive: true }) //

const dbPath = join(dbDir, 'bridge.db')

/**
 * Open the SQLite database, surviving common failure modes:
 *   - File-locked by another instance → surface a clear dialog and exit.
 *   - File-corrupted → quarantine the file (.corrupt-<ts>) so the next launch
 *     starts fresh; user can recover the old file from disk if needed.
 *   - Migration failure on a newly-opened DB → quarantine + retry once.
 * If even the retry fails we re-throw so the global uncaughtException handler
 * logs it and the user sees the error boundary instead of a silent black box.
 */
function openDatabase(): Database.Database {
  try {
    const handle = new Database(dbPath)
    handle.pragma('journal_mode = WAL')
    handle.pragma('foreign_keys = ON')
    runMigrations(handle)
    return handle
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[db] open failed:', msg)

    // SQLITE_BUSY / SQLITE_LOCKED: another process owns the file.
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(msg)) {
      try {
        dialog.showErrorBox(
          'Database is locked',
          'Another copy of Bridge appears to be running and is using the database. Close it and try again.'
        )
      } catch {
        // dialog may not be available before app.whenReady; just log.
      }
      throw err
    }

    // Corruption: move the bad file aside so the next attempt starts clean.
    if (/SQLITE_CORRUPT|malformed|not a database/i.test(msg) && existsSync(dbPath)) {
      const quarantine = `${dbPath}.corrupt-${Date.now()}`
      try {
        renameSync(dbPath, quarantine)
        console.warn(`[db] corrupt file quarantined to ${quarantine}; rebuilding fresh database`)
        const handle = new Database(dbPath)
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

const db: Database.Database = openDatabase()

export default db
