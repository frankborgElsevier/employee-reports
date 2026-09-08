import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { closeDatabase, initDatabase } from "../../src/db/connection.js";
import { getAllExternalManagers, getEmployeeById, getSalaryHistory } from "../../src/db/index.js";

test("spec 012 migration removes legacy contractor linkage and preserves imported data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-012-migration-"));
  const dbPath = path.join(dir, "legacy.sqlite");
  const legacy = new Database(dbPath);
  legacy.pragma("foreign_keys = ON");
  legacy.exec(`
    CREATE TABLE external_managers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE employees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL, country TEXT NOT NULL,
      worker_type TEXT NOT NULL DEFAULT 'employee', workday_worker_id TEXT,
      latest_import_matched INTEGER NOT NULL DEFAULT 0, end_date TEXT,
      manager_id TEXT REFERENCES employees(id) ON DELETE RESTRICT,
      external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX idx_contractors_workday_worker_id ON employees(workday_worker_id)
      WHERE worker_type = 'contractor' AND workday_worker_id IS NOT NULL;
    CREATE TABLE salary_history (id INTEGER PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, effective_year INTEGER NOT NULL, currency TEXT NOT NULL, base_salary REAL NOT NULL, bonus REAL NOT NULL DEFAULT 0, comp_ratio REAL, UNIQUE(employee_id, effective_year));
    CREATE TABLE rating_history (id INTEGER PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, rating_period TEXT NOT NULL, rating_value TEXT NOT NULL, UNIQUE(employee_id, rating_period));
    INSERT INTO external_managers VALUES ('external', 'External Manager');
    INSERT INTO employees VALUES ('manager', 'Alex', 'Manager', 'UK', 'employee', NULL, 0, NULL, NULL, NULL);
    INSERT INTO employees VALUES ('employee', 'Rita', 'Engineer', 'UK', 'employee', NULL, 0, NULL, 'manager', NULL);
    INSERT INTO employees VALUES ('contractor', 'Sam', 'Engineer', 'India', 'contractor', 'LEGACY-WD', 1, NULL, NULL, 'external');
    INSERT INTO salary_history VALUES (1, 'employee', 2026, 'USD', 100, 0, NULL);
    INSERT INTO rating_history VALUES (1, 'employee', 'Most Recent', 'Exceeds');
  `);
  legacy.close();

  try {
    const migrated = initDatabase(dbPath);
    const columns = migrated.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === "workday_worker_id"), false);
    assert.equal(columns.some((column) => column.name === "latest_import_matched"), false);
    assert.equal(getEmployeeById("contractor")?.externalManagerId, null);
    assert.equal(getEmployeeById("employee")?.managerId, "manager");
    assert.deepEqual(getSalaryHistory("employee").map((row) => row.baseSalary), [100]);
    assert.deepEqual(getAllExternalManagers(), [{ id: "external", name: "External Manager" }]);
    assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    closeDatabase();

    // Opening the completed migration again is an idempotent no-op.
    initDatabase(dbPath);
    assert.equal(getEmployeeById("contractor")?.externalManagerId, null);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
