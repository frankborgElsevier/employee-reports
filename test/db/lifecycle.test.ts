import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase, runInTransaction } from "../../src/db/connection.js";
import { InitializationError } from "../../src/db/errors.js";
import { upsertEmployee } from "../../src/db/mutations.js";
import { getEmployeeById } from "../../src/db/queries.js";
import { withFreshDatabase } from "./helpers.js";

test("FR-4.2: initDatabase creates a new SQLite file containing all defined tables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    const db = initDatabase(dbPath);
    assert.ok(fs.existsSync(dbPath));
    const tables = db
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, ["employees", "external_managers", "rating_history", "salary_history"]);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("FR-4.2: calling initDatabase while a connection is already open throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    assert.throws(() => initDatabase(path.join(dir, "other.sqlite")), InitializationError);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("FR-4.2: initDatabase with a missing parent directory throws", () => {
  const dbPath = path.join(os.tmpdir(), "data-foundation-test-missing-dir", "test.sqlite");
  assert.throws(() => initDatabase(dbPath), InitializationError);
});

test("FR-4.2: closeDatabase() followed by initDatabase succeeds without throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    closeDatabase();
    assert.doesNotThrow(() => initDatabase(dbPath));
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-1.3: foreign key integrity is enforced (inserting with a non-existent manager_id fails)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    const db = initDatabase(dbPath);
    assert.throws(() => {
      db.prepare(
        "INSERT INTO employees (id, name, position, country, manager_id) VALUES (?, ?, ?, ?, ?)",
      ).run("emp-1", "Bob", "Engineer", "UK", "ghost-manager");
    });
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-4.2: the database file is created with owner-only permissions on POSIX", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    const mode = fs.statSync(dbPath).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-4.2: a pre-existing database file's permissions are left untouched", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  fs.writeFileSync(dbPath, "");
  fs.chmodSync(dbPath, 0o644);
  try {
    initDatabase(dbPath);
    const mode = fs.statSync(dbPath).mode & 0o777;
    assert.equal(mode, 0o644);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "AR-4.3: a failed initDatabase restores the process umask instead of leaking it",
  { skip: process.platform === "win32" },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
    // A directory can't be opened as a SQLite file, so this forces initDatabase
    // to fail after it has already set the restrictive umask.
    const dbPath = path.join(dir, "not-a-file");
    fs.mkdirSync(dbPath);
    const umaskBefore = process.umask();
    try {
      assert.throws(() => initDatabase(dbPath));
      assert.equal(process.umask(), umaskBefore);

      // The failure must also leave state clean enough for a real retry to succeed.
      const realDbPath = path.join(dir, "real.sqlite");
      assert.doesNotThrow(() => initDatabase(realDbPath));
    } finally {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("FR-4.2: initDatabase rejects an outdated schema (rating_year instead of rating_period)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(
      `CREATE TABLE rating_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT NOT NULL,
        rating_year INTEGER NOT NULL,
        rating_value TEXT NOT NULL,
        UNIQUE (employee_id, rating_year)
      );`,
    );
    legacyDb.close();
    assert.throws(() => initDatabase(dbPath), InitializationError);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spec 007: initDatabase adds worker_type to a pre-existing employees table and preserves existing rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(
      `CREATE TABLE employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position TEXT NOT NULL,
        country TEXT NOT NULL,
        end_date TEXT,
        manager_id TEXT REFERENCES employees(id) ON DELETE RESTRICT
      );`,
    );
    legacyDb
      .prepare("INSERT INTO employees (id, name, position, country) VALUES (?, ?, ?, ?)")
      .run("emp-1", "Bob", "Engineer", "UK");
    legacyDb.close();

    assert.doesNotThrow(() => initDatabase(dbPath));
    assert.deepEqual(getEmployeeById("emp-1"), {
      id: "emp-1",
      name: "Bob",
      position: "Engineer",
      country: "UK",
      workerType: "employee",
      endDate: null,
      managerId: null,
      externalManagerId: null,
    });
    const db = new Database(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
    assert.equal(columns.filter((column) => column.name === "worker_type").length, 1);
    assert.equal(columns.filter((column) => column.name === "workday_worker_id").length, 0);
    assert.equal(columns.filter((column) => column.name === "latest_import_matched").length, 0);
    db.close();
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("FR-4.5: runInTransaction rolls back every write when the callback throws", () => {
  withFreshDatabase(() => {
    assert.throws(() => {
      runInTransaction(() => {
        upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
        throw new Error("boom");
      });
    }, /boom/);
    assert.equal(getEmployeeById("emp-1"), null);
  });
});

test("FR-4.5: runInTransaction commits all writes and returns the callback's result", () => {
  withFreshDatabase(() => {
    const result = runInTransaction(() => {
      upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
      upsertEmployee({ id: "emp-2", name: "Amy", position: "Engineer", country: "UK" });
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(getEmployeeById("emp-1")?.name, "Bob");
    assert.equal(getEmployeeById("emp-2")?.name, "Amy");
  });
});

test("end-to-end: upsert and read back an employee across a fresh connection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    assert.equal(getEmployeeById("emp-1")?.name, "Bob");
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
