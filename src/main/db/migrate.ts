import type Database from 'better-sqlite3'

type Migration =
  | { version: number; sql: string }
  | { version: number; fn: (db: Database.Database) => void }

const migrations: Migration[] = [
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
  },
  {
    version: 2,
    sql: `
      -- Seed groups
      INSERT OR IGNORE INTO groups (name, description) VALUES ('Head Office', 'Main headquarters');
      INSERT OR IGNORE INTO groups (name, description) VALUES ('Branch', 'Branch office');
      INSERT OR IGNORE INTO groups (name, description) VALUES ('Warehouse', 'Warehouse location');

      -- Seed stores
      INSERT OR IGNORE INTO stores (name, code) VALUES ('Store A', 'STR-A');
      INSERT OR IGNORE INTO stores (name, code) VALUES ('Store B', 'STR-B');
      INSERT OR IGNORE INTO stores (name, code) VALUES ('Store C', 'STR-C');

      -- Seed fiscal years
      INSERT OR IGNORE INTO fiscal_years (name) VALUES ('2024-25');
      INSERT OR IGNORE INTO fiscal_years (name) VALUES ('2025-26');
      INSERT OR IGNORE INTO fiscal_years (name) VALUES ('2026-27');

      -- Seed 3 initial connections
      INSERT INTO connections (name, group_id, static_ip, vpn_ip, db_name, username, password, trust_cert, fiscal_year_id, store_id, status)
        VALUES ('Head Office Production', 1, '192.168.1.100', '10.8.0.1', 'company_hq', 'sa', '', 1, 1, 1, 'online');
      INSERT INTO connections (name, group_id, static_ip, vpn_ip, db_name, username, password, trust_cert, fiscal_year_id, store_id, status)
        VALUES ('Branch Delhi', 2, '192.168.2.50', '10.8.0.5', 'company_delhi', 'sa', '', 0, 1, 2, 'offline');
      INSERT INTO connections (name, group_id, static_ip, vpn_ip, db_name, username, password, trust_cert, fiscal_year_id, store_id, status)
        VALUES ('Warehouse Noida', 3, '192.168.3.10', '10.8.0.12', 'warehouse_noida', 'admin', '', 1, 2, 3, 'unknown');
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_online_interval', '300');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_offline_base', '180');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_backoff_max', '1800');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_workers', '5');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_connection_timeout', '15');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('monitor_startup_test', 'true');
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
        name               TEXT     NOT NULL,
        description        TEXT,
        connection_ids     TEXT     NOT NULL DEFAULT '[]',
        online_only        INTEGER  NOT NULL DEFAULT 0,
        is_multi           INTEGER  NOT NULL DEFAULT 0,
        type               TEXT     NOT NULL CHECK(type IN ('query', 'action')),
        sql_query          TEXT     NOT NULL DEFAULT '[]',
        sql_query_names    TEXT     NOT NULL DEFAULT '[]',
        destination_type   TEXT     CHECK(destination_type IN ('api', 'google_sheets', 'excel')),
        destination_config TEXT,
        operation          TEXT     CHECK(operation IN ('append', 'replace')),
        notify_webhook     TEXT,
        status             TEXT     NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'success', 'failed')),
        last_run_at        TEXT,
        last_error         TEXT,
        created_at         TEXT     DEFAULT (datetime('now')),
        updated_at         TEXT     DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE jobs ADD COLUMN schedule TEXT DEFAULT NULL;
    `
  },
  {
    version: 6,
    fn(db: Database.Database): void {
      // Safely add columns that may be missing from an older v4 migration
      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )

      const missing: [string, string][] = [
        ['destination_config', 'TEXT'],
        ['destination_type', "TEXT CHECK(destination_type IN ('api', 'google_sheets', 'excel'))"],
        ['operation', "TEXT CHECK(operation IN ('append', 'replace'))"],
        ['notify_webhook', 'TEXT'],
        ['last_error', 'TEXT'],
        ['online_only', 'INTEGER NOT NULL DEFAULT 0']
      ]

      for (const [col, def] of missing) {
        if (!cols.includes(col)) {
          db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`)
        }
      }
    }
  },
  {
    version: 7,
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('job_query_timeout', '30');
    `
  },
  {
    version: 8,
    fn(db: Database.Database): void {
      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )

      if (!cols.includes('online_only')) {
        db.exec('ALTER TABLE jobs ADD COLUMN online_only INTEGER NOT NULL DEFAULT 0')
      }
    }
  },
  {
    version: 9,
    sql: `
      -- Job run history table for executed jobs (Phase 2)
      CREATE TABLE IF NOT EXISTS job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        rows_processed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        failed_connection_ids TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 10,
    fn(db: Database.Database): void {
      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )

      if (!cols.includes('group_id')) {
        db.exec(
          'ALTER TABLE jobs ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL'
        )
      }
    }
  },
  {
    version: 11,
    fn(db: Database.Database): void {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_groups (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL UNIQUE,
          description TEXT,
          created_at  TEXT    DEFAULT (datetime('now')),
          updated_at  TEXT    DEFAULT (datetime('now'))
        );
      `)

      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )

      if (!cols.includes('job_group_id')) {
        db.exec(
          'ALTER TABLE jobs ADD COLUMN job_group_id INTEGER REFERENCES job_groups(id) ON DELETE SET NULL'
        )
      }

      // One-time backfill from the previous jobs.group_id linkage (if any exists).
      if (cols.includes('group_id')) {
        db.exec(`
          INSERT OR IGNORE INTO job_groups (name, description)
          SELECT DISTINCT g.name, g.description
          FROM jobs j
          JOIN groups g ON g.id = j.group_id
          WHERE j.group_id IS NOT NULL;

          UPDATE jobs
          SET job_group_id = (
            SELECT jg.id
            FROM groups g
            JOIN job_groups jg ON jg.name = g.name
            WHERE g.id = jobs.group_id
            LIMIT 1
          )
          WHERE job_group_id IS NULL AND group_id IS NOT NULL;
        `)
      }
    }
  },
  {
    version: 12,
    fn(db: Database.Database): void {
      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )
      if (!cols.includes('template_path')) {
        db.exec('ALTER TABLE jobs ADD COLUMN template_path TEXT')
      }
      if (!cols.includes('template_mode')) {
        db.exec(
          "ALTER TABLE jobs ADD COLUMN template_mode TEXT CHECK(template_mode IN ('new','existing'))"
        )
      }
    }
  },
  {
    version: 13,
    fn(db: Database.Database): void {
      // Seed excel_sheet_row_threshold default (800_000) if not present.
      const existing = db
        .prepare("SELECT value FROM settings WHERE key = 'excel_sheet_row_threshold'")
        .get()
      if (!existing) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
          'excel_sheet_row_threshold',
          '800000'
        )
      }
    }
  },
  {
    version: 14,
    fn(db: Database.Database): void {
      // Seed sheet naming defaults.
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
      )
      upsert.run('excel_sheet_name_source', 'connection_name')
      upsert.run('excel_create_empty_sheets', 'false')
    }
  },
  {
    version: 15,
    fn(db: Database.Database): void {
      // Add remote_id TEXT column to every syncable table so rows can be
      // mapped to their server-side UUID after push/pull.
      const tables = ['stores', 'fiscal_years', 'groups', 'job_groups', 'connections', 'jobs']
      for (const t of tables) {
        const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
          (c) => c.name
        )
        if (!cols.includes('remote_id')) {
          db.exec(`ALTER TABLE ${t} ADD COLUMN remote_id TEXT`)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_remote_id ON ${t}(remote_id)`)
        }
      }
    }
  },
  {
    version: 16,
    fn(db: Database.Database): void {
      const cols = (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(
        (c) => c.name
      )
      if (!cols.includes('sql_query_names')) {
        db.exec("ALTER TABLE jobs ADD COLUMN sql_query_names TEXT NOT NULL DEFAULT '[]'")
      }
    }
  },
  {
    version: 17,
    fn(db: Database.Database): void {
      // Update sheet-naming defaults to match current DEFAULT_SETTINGS:
      // store_code (was connection_name) and create_empty_sheets = true (was false).
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      upsert.run('excel_sheet_name_source', 'store_code')
      upsert.run('excel_create_empty_sheets', 'true')
    }
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
      if ('fn' in migration) {
        migration.fn(db)
      } else {
        db.exec(migration.sql)
      }
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(migration.version)
      console.log(`[DB] Migration v${migration.version} applied`)
    }
  }
}
