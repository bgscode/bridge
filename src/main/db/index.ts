import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { runMigrations } from './migrate'

const userDataPath = app.getPath('userData')
const dbDir = join(userDataPath, 'bridge-db')
mkdirSync(dbDir, { recursive: true })

const db: Database.Database = new Database(join(dbDir, 'bridge.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

runMigrations(db)

export default db
