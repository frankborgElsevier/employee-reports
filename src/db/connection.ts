import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { SCHEMA_SQL } from "./schema.js";
import { InitializationError } from "./errors.js";

const RESTRICTIVE_UMASK = 0o077;
const OWNER_ONLY_FILE_MODE = 0o600;

let connection: Database.Database | null = null;
let previousUmask: number | undefined;

function isPosix(): boolean {
  return process.platform !== "win32";
}

function restorePreviousUmask(): void {
  if (previousUmask !== undefined) {
    try {
      process.umask(previousUmask);
    } catch {
      // ignore — best effort restoration
    }
    previousUmask = undefined;
  }
}

/**
 * FR-4.2: `CREATE TABLE IF NOT EXISTS` (AR-1.2) leaves an already-existing
 * table untouched, so an old-shaped database from before the 2026-08-31
 * `rating_year` -> `rating_period` change would otherwise be opened
 * silently. Detect that case and fail loudly instead.
 */
function assertCompatibleSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(rating_history)").all() as Array<{ name: string }>;
  const hasOldColumn = columns.some((column) => column.name === "rating_year");
  if (hasOldColumn) {
    throw new InitializationError(
      "Database uses an outdated rating_history schema (rating_year instead of rating_period) " +
        "and cannot be opened by this version. This project has no migration framework " +
        "(see spec 001 Constraints) — use a fresh database file.",
    );
  }
}

/**
 * AR-2.1/ADR-001 (spec 005): `CREATE TABLE IF NOT EXISTS` (above) is a no-op
 * for a table that already exists, so a pre-existing `employees` table
 * (from a database created before this spec) never gains the new
 * `external_manager_id` column just by re-running `SCHEMA_SQL`. This is
 * additive and non-destructive — unlike `assertCompatibleSchema` above,
 * which *rejects* an incompatible database, this *upgrades* one that is
 * simply missing a new nullable column, and does not touch existing rows,
 * `manager_id`, or any history table. Idempotent: a database that already
 * has the column (freshly created, or already migrated) is left alone.
 */
function migrateExternalManagerColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === "external_manager_id");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE employees ADD COLUMN external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL",
    );
  }
}

/** Adds the additive worker discriminator used by manually entered contractors. */
function migrateWorkerTypeColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === "worker_type");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE employees ADD COLUMN worker_type TEXT NOT NULL DEFAULT 'employee' CHECK (worker_type IN ('employee', 'contractor'))",
    );
  }
}

/**
 * Spec 012 rebuilds the legacy contractor-link table shape. SQLite cannot drop
 * columns directly, so copy only retained fields into a replacement table.
 * This runs once for databases that still carry either retired column.
 */
function migrateRemoveContractorImportColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "workday_worker_id" || column.name === "latest_import_matched")) return;

  // Disable enforcement only while replacing the referenced parent table;
  // data is checked with foreign_key_check before the transaction commits.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec("DROP INDEX IF EXISTS idx_contractors_workday_worker_id");
      // Legacy external-manager links are intentionally not valid contractor
      // placement in Spec 012. Imported rows are copied unchanged.
      db.exec("UPDATE employees SET external_manager_id = NULL WHERE worker_type = 'contractor'");
      db.exec(`CREATE TABLE employees_rebuilt (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position TEXT NOT NULL,
        country TEXT NOT NULL,
        worker_type TEXT NOT NULL DEFAULT 'employee' CHECK (worker_type IN ('employee', 'contractor')),
        end_date TEXT,
        manager_id TEXT REFERENCES employees_rebuilt(id) ON DELETE RESTRICT,
        external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL
      )`);
      db.exec(`INSERT INTO employees_rebuilt
        (id, name, position, country, worker_type, end_date, manager_id, external_manager_id)
        SELECT id, name, position, country, worker_type, end_date, manager_id, external_manager_id
        FROM employees`);
      db.exec("DROP TABLE employees");
      db.exec("ALTER TABLE employees_rebuilt RENAME TO employees");
      db.exec("CREATE INDEX idx_employees_manager_id ON employees(manager_id)");
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new InitializationError("Database migration failed foreign-key validation.");
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * AR-2.1 (spec 006): the same additive, idempotent pattern as
 * `migrateExternalManagerColumn` above, applied to `salary_history`'s new
 * nullable `comp_ratio` column. `CREATE TABLE IF NOT EXISTS` never adds a
 * column to an existing table, so a pre-existing database gains it here
 * instead — leaving every existing row's `comp_ratio` NULL, which is exactly
 * the "no compa ratio known" state (FR-2.2). Idempotent: a database that
 * already has the column is left alone.
 */
function migrateCompRatioColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(salary_history)").all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === "comp_ratio");
  if (!hasColumn) {
    db.exec("ALTER TABLE salary_history ADD COLUMN comp_ratio REAL");
  }
}

/**
 * Opens or creates the SQLite database at `path`. Enables foreign keys and
 * runs the idempotent schema-initialization script (AR-1.2, AR-1.3).
 *
 * AR-4.2: a restrictive process umask is set for as long as this connection
 * is open, so every file SQLite creates (the main file and any -wal/-shm/
 * -journal sidecars, whenever they're created) inherits owner-only
 * permissions automatically. Pre-existing files are left untouched.
 */
export function initDatabase(dbPath: string): Database.Database {
  if (connection !== null) {
    throw new InitializationError(
      "initDatabase was called while a connection is already open; call closeDatabase() first.",
    );
  }

  const parentDir = path.dirname(dbPath);
  if (!fs.existsSync(parentDir)) {
    throw new InitializationError(
      `Cannot create database at ${dbPath}: parent directory ${parentDir} does not exist.`,
    );
  }

  const fileExistedBefore = fs.existsSync(dbPath);

  if (isPosix()) {
    try {
      previousUmask = process.umask(RESTRICTIVE_UMASK);
    } catch {
      previousUmask = undefined;
    }
  }

  try {
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    assertCompatibleSchema(db);
    migrateExternalManagerColumn(db);
    migrateWorkerTypeColumn(db);
    migrateRemoveContractorImportColumns(db);
    migrateCompRatioColumn(db);

    if (isPosix() && !fileExistedBefore) {
      try {
        fs.chmodSync(dbPath, OWNER_ONLY_FILE_MODE);
      } catch {
        // best-effort local-file protection; not fatal if the OS refuses it.
      }
    }

    connection = db;
    return db;
  } catch (error) {
    // Restore the umask on any failure — there is no successful connection
    // here for a caller to closeDatabase(), so if we don't undo it now it
    // would otherwise leak for the rest of the process's lifetime.
    restorePreviousUmask();
    throw error;
  }
}

/** Closes the current connection and restores the prior process umask (AR-4.3). */
export function closeDatabase(): void {
  if (connection !== null) {
    connection.close();
    connection = null;
  }
  restorePreviousUmask();
}

export function getConnection(): Database.Database {
  if (connection === null) {
    throw new InitializationError("No database connection is open; call initDatabase() first.");
  }
  return connection;
}

/**
 * FR-4.5: runs `fn` inside a single transaction on the shared connection,
 * committing its result or rolling back and rethrowing if it throws. This
 * is the supported way for a caller to get atomicity across multiple calls
 * to this module's write functions — `getConnection()` itself is not part
 * of the public API (AR-4.3).
 */
export function runInTransaction<T>(fn: () => T): T {
  return getConnection().transaction(fn)();
}
