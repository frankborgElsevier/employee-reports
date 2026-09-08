import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../src/db/connection.js";
import { NotFoundError, ValidationError } from "../../src/db/errors.js";
import { setExternalManager, upsertEmployee, upsertExternalManager } from "../../src/db/mutations.js";
import { getAllEmployees, getAllExternalManagers, getEmployeeById } from "../../src/db/queries.js";
import { withFreshDatabase } from "./helpers.js";

function seedEmployee(id = "emp-1"): void {
  upsertEmployee({ id, name: "Bob", position: "Engineer", country: "UK" });
}

test("FR-2.2: upsertExternalManager inserts a new external manager", () => {
  withFreshDatabase(() => {
    upsertExternalManager("ext-1", "Frank Borg");
    assert.deepEqual(getAllExternalManagers(), [{ id: "ext-1", name: "Frank Borg" }]);
  });
});

test("FR-2.2: a second upsertExternalManager call with the same id replaces the name, not merges/appends", () => {
  withFreshDatabase(() => {
    upsertExternalManager("ext-1", "F. Borg");
    upsertExternalManager("ext-1", "Frank Borg");
    const all = getAllExternalManagers();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "Frank Borg");
  });
});

test("AR-2.2: upsertExternalManager rejects a blank id or name", () => {
  withFreshDatabase(() => {
    assert.throws(() => upsertExternalManager("   ", "Frank Borg"), ValidationError);
    assert.throws(() => upsertExternalManager("ext-1", "   "), ValidationError);
  });
});

test("AR-2.2: setExternalManager throws NotFoundError for an unknown employeeId", () => {
  withFreshDatabase(() => {
    upsertExternalManager("ext-1", "Frank Borg");
    assert.throws(() => setExternalManager("ghost", "ext-1"), NotFoundError);
  });
});

test("AR-2.2: setExternalManager throws NotFoundError when externalManagerId doesn't exist in external_managers", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => setExternalManager("emp-1", "ghost-ext"), NotFoundError);
  });
});

test("AR-2.2: setExternalManager links an employee to an existing external manager", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertExternalManager("ext-1", "Frank Borg");
    setExternalManager("emp-1", "ext-1");
    assert.equal(getEmployeeById("emp-1")?.externalManagerId, "ext-1");
  });
});

test("AR-2.2: setExternalManager(id, null) clears an existing link", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertExternalManager("ext-1", "Frank Borg");
    setExternalManager("emp-1", "ext-1");
    setExternalManager("emp-1", null);
    assert.equal(getEmployeeById("emp-1")?.externalManagerId, null);
  });
});

test("AR-2.1: getAllExternalManagers() returns everything stored", () => {
  withFreshDatabase(() => {
    upsertExternalManager("ext-1", "Frank Borg");
    upsertExternalManager("ext-2", "Jane Doe");
    const all = getAllExternalManagers();
    assert.deepEqual(
      all.map((m) => m.id).sort(),
      ["ext-1", "ext-2"],
    );
  });
});

test("AR-2.1: externalManagerId round-trips through upsertEmployee + setExternalManager + getEmployeeById/getAllEmployees", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertExternalManager("ext-1", "Frank Borg");
    setExternalManager("emp-1", "ext-1");

    assert.equal(getEmployeeById("emp-1")?.externalManagerId, "ext-1");
    const all = getAllEmployees();
    assert.equal(all.find((e) => e.id === "emp-1")?.externalManagerId, "ext-1");

    // Re-upserting the employee (e.g. a re-import) must not disturb external_manager_id,
    // mirroring manager_id's existing behavior (upsertEmployee has no such field).
    upsertEmployee({ id: "emp-1", name: "Bob Jr.", position: "Engineer", country: "US" });
    assert.equal(getEmployeeById("emp-1")?.externalManagerId, "ext-1");
  });
});

test("Rollout & migration: initDatabase adds external_manager_id to a pre-existing employees table without touching existing rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    // Hand-write the OLD schema shape: employees table WITHOUT external_manager_id,
    // modeled on lifecycle.test.ts's "outdated rating_history schema" setup.
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
    const db = new Database(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
    assert.ok(columns.some((c) => c.name === "external_manager_id"));
    const row = db.prepare("SELECT * FROM employees WHERE id = ?").get("emp-1") as Record<string, unknown>;
    assert.equal(row.name, "Bob");
    assert.equal(row.position, "Engineer");
    assert.equal(row.country, "UK");
    db.close();
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Rollout & migration: the migration step is idempotent — running initDatabase twice on the same file does not throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    closeDatabase();
    assert.doesNotThrow(() => initDatabase(dbPath));
    const db = new Database(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
    assert.equal(columns.filter((c) => c.name === "external_manager_id").length, 1);
    db.close();
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
