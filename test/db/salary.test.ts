import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../src/db/connection.js";
import { NotFoundError, ValidationError } from "../../src/db/errors.js";
import { upsertEmployee, upsertSalaryRecord } from "../../src/db/mutations.js";
import { getCurrentSalary, getSalaryHistory } from "../../src/db/queries.js";
import { withFreshDatabase } from "./helpers.js";

function seedEmployee(): void {
  upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
}

test("FR-2.1: two salary rows for the same employee/year is a single upserted row", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000);
    upsertSalaryRecord("emp-1", 2024, "GBP", 55000, 1500);
    const history = getSalaryHistory("emp-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].baseSalary, 55000);
  });
});

test("FR-2.2: current salary is the highest effective_year not greater than the current year", () => {
  withFreshDatabase(() => {
    seedEmployee();
    const nextYear = new Date().getUTCFullYear() + 1;
    upsertSalaryRecord("emp-1", 2023, "GBP", 40000);
    upsertSalaryRecord("emp-1", 2024, "GBP", 45000);
    upsertSalaryRecord("emp-1", nextYear, "GBP", 60000);
    const current = getCurrentSalary("emp-1");
    assert.equal(current?.effectiveYear, 2024);
  });
});

test("FR-2.3: negative base_salary is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "GBP", -1000), ValidationError);
  });
});

test("FR-2.3: lowercase currency code is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "gbp", 1000), ValidationError);
  });
});

test("FR-2.3: effective_year boundary is inclusive at 1990", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 1989, "GBP", 1000), ValidationError);
    assert.doesNotThrow(() => upsertSalaryRecord("emp-1", 1990, "GBP", 1000));
  });
});

test("FR-2.3: non-finite base_salary is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "GBP", Infinity), ValidationError);
  });
});

test("FR-2.3: bonus = 0 is valid, and is the default when omitted", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000);
    assert.equal(getCurrentSalary("emp-1")?.bonus, 0);
  });
});

test("AR-2.3: base_salary/bonus are rounded to 2 decimal places", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000.005, 999.999);
    const current = getCurrentSalary("emp-1");
    assert.equal(current?.baseSalary, 50000.01);
    assert.equal(current?.bonus, 1000);
  });
});

test("FR-2.2: a supplied compRatio is persisted exactly, without the 2-decimal rounding base_salary/bonus get", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, 1.141603);
    assert.equal(getCurrentSalary("emp-1")?.compRatio, 1.141603);
  });
});

test("FR-2.2: compRatio defaults to null when the sixth parameter is omitted", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000);
    assert.equal(getCurrentSalary("emp-1")?.compRatio, null);
  });
});

test("FR-2.2: comp_ratio is independently nullable — a salary row exists with currency/baseSalary/bonus populated and compRatio null", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, null);
    const current = getCurrentSalary("emp-1");
    assert.ok(current);
    assert.equal(current?.currency, "GBP");
    assert.equal(current?.baseSalary, 50000);
    assert.equal(current?.bonus, 1000);
    assert.equal(current?.compRatio, null);
  });
});

test("FR-2.2: a negative compRatio is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, -0.5), ValidationError);
  });
});

test("FR-2.2: a non-finite compRatio is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, Infinity), ValidationError);
    assert.throws(() => upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, NaN), ValidationError);
  });
});

test("FR-2.2: compRatio 0 is valid (finite and non-negative), and is not conflated with null", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, 0);
    assert.equal(getCurrentSalary("emp-1")?.compRatio, 0);
  });
});

test("FR-2.2: no plausibility ceiling — a wrong-units value like 114.1603 is accepted as supplied", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, 114.1603);
    assert.equal(getCurrentSalary("emp-1")?.compRatio, 114.1603);
  });
});

test("FR-2.2: an upsert over an existing row replaces comp_ratio, including back to null", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 50000, 1000, 1.141603);
    upsertSalaryRecord("emp-1", 2024, "GBP", 55000, 1500, null);
    const history = getSalaryHistory("emp-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].compRatio, null);
    assert.equal(history[0].baseSalary, 55000);
  });
});

test("FR-4.3: upsertSalaryRecord with a non-existent employee id throws", () => {
  withFreshDatabase(() => {
    assert.throws(() => upsertSalaryRecord("ghost", 2024, "GBP", 1000), NotFoundError);
  });
});

test("AR-4.4: getCurrentSalary returns null for an employee with no eligible row", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.equal(getCurrentSalary("emp-1"), null);
  });
});

test("FR-4.1: getSalaryHistory returns the full history ordered ascending by year", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertSalaryRecord("emp-1", 2024, "GBP", 45000);
    upsertSalaryRecord("emp-1", 2022, "GBP", 40000);
    upsertSalaryRecord("emp-1", 2023, "GBP", 42000);
    assert.deepEqual(
      getSalaryHistory("emp-1").map((r) => r.effectiveYear),
      [2022, 2023, 2024],
    );
  });
});

test("AR-2.1: initDatabase adds comp_ratio to a pre-existing salary_history table without touching existing rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    // Hand-write the OLD schema shape: salary_history WITHOUT comp_ratio,
    // mirroring externalManagers.test.ts's external_manager_id migration test.
    const legacyDb = new Database(dbPath);
    legacyDb.exec(
      `CREATE TABLE salary_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT NOT NULL,
        effective_year INTEGER NOT NULL,
        currency TEXT NOT NULL,
        base_salary REAL NOT NULL,
        bonus REAL NOT NULL DEFAULT 0,
        UNIQUE (employee_id, effective_year)
      );`,
    );
    legacyDb
      .prepare(
        "INSERT INTO salary_history (employee_id, effective_year, currency, base_salary, bonus) VALUES (?, ?, ?, ?, ?)",
      )
      .run("emp-1", 2024, "GBP", 50000, 1000);
    legacyDb.close();

    assert.doesNotThrow(() => initDatabase(dbPath));
    const db = new Database(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(salary_history)").all() as Array<{ name: string }>;
    assert.ok(columns.some((c) => c.name === "comp_ratio"));
    const row = db
      .prepare("SELECT * FROM salary_history WHERE employee_id = ?")
      .get("emp-1") as Record<string, unknown>;
    assert.equal(row.currency, "GBP");
    assert.equal(row.base_salary, 50000);
    assert.equal(row.bonus, 1000);
    assert.equal(row.comp_ratio, null);
    db.close();
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-2.1: the comp_ratio migration is idempotent — running initDatabase twice on the same file does not throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  try {
    initDatabase(dbPath);
    closeDatabase();
    assert.doesNotThrow(() => initDatabase(dbPath));
    const db = new Database(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(salary_history)").all() as Array<{ name: string }>;
    assert.equal(columns.filter((c) => c.name === "comp_ratio").length, 1);
    db.close();
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
