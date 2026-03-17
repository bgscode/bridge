import type Database from 'better-sqlite3'

const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS groups (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        description TEXT,
        created_at  TEXT    DEFAULT (datetime('now')),
        updated_at  TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stores (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        code        TEXT    NOT NULL UNIQUE,
        created_at  TEXT    DEFAULT (datetime('now')),
        updated_at  TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS fiscal_years (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        created_at  TEXT    DEFAULT (datetime('now')),
        updated_at  TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS connections (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
        static_ip   TEXT,
        vpn_ip      TEXT,
        db_name     TEXT,
        username    TEXT,
        password    TEXT,
        trust_cert  INTEGER DEFAULT 0,
        fiscal_year_id INTEGER REFERENCES fiscal_years(id) ON DELETE SET NULL,
        store_id    INTEGER REFERENCES stores(id) ON DELETE SET NULL,
        status      TEXT    DEFAULT 'unknown',
        created_at  TEXT    DEFAULT (datetime('now')),
        updated_at  TEXT    DEFAULT (datetime('now'))
      );
    `
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `)

  const applied = (db.prepare('SELECT version FROM migrations').all() as { version: number }[]).map(
    (r) => r.version
  )

  for (const migration of migrations) {
    if (!applied.includes(migration.version)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(migration.version)
      console.log(`[DB] Migration v${migration.version} applied`)
    }
  }
}
