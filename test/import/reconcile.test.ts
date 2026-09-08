import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../../src/import/reconcile.js";
import type { ImportRow } from "../../src/import/types.js";
import {
  createContractor,
  getAllEmployees,
  getAllExternalManagers,
  getEmployeeById,
  getRatingHistory,
  getSalaryHistory,
} from "../../src/db/index.js";
import { withFreshDatabase } from "../db/helpers.js";

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    employeeId: "1001",
    name: "Alice Example",
    position: "Engineer",
    country: "UK",
    supervisorId: null,
    supervisorName: null,
    currency: "USD",
    baseSalary: 100000,
    bonus: 10000,
    compRatio: null,
    ratings: { "Most Recent": "Exceeds" },
    ...overrides,
  };
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

test("FR-2.1: a new employee is added; a re-import of the same row updates, not duplicates", () => {
  withFreshDatabase(() => {
    const counts1 = reconcile([row()], { commit: true }, NOW);
    assert.deepEqual(counts1, { added: 1, updated: 0, inactivated: 0 });

    const counts2 = reconcile([row({ position: "Senior Engineer" })], { commit: true }, NOW);
    assert.deepEqual(counts2, { added: 0, updated: 1, inactivated: 0 });
    assert.equal(getEmployeeById("1001")?.position, "Senior Engineer");
    assert.equal(getAllEmployees().length, 1);
  });
});

test("spec 007: preview and committed imports leave manually entered contractors unchanged and out of counts", () => {
  withFreshDatabase(() => {
    const contractor = createContractor({
      name: "Sam Taylor",
      position: "Senior Software Engineer II",
      country: "India",
      managerId: null,
    });

    const previewCounts = reconcile([row()], { commit: false }, NOW);
    assert.deepEqual(previewCounts, { added: 1, updated: 0, inactivated: 0 });
    assert.equal(getEmployeeById("1001"), null);
    assert.deepEqual(getEmployeeById(contractor.id), contractor);

    const committedCounts = reconcile([row()], { commit: true }, NOW);
    assert.deepEqual(committedCounts, { added: 1, updated: 0, inactivated: 0 });
    assert.deepEqual(getEmployeeById(contractor.id), contractor);
    assert.deepEqual(getAllEmployees({ workerType: "all" }).map((employee) => employee.id), ["1001", contractor.id]);
  });
});

test("spec 012: an import row sharing a legacy-style contractor ID is imported normally", () => {
  withFreshDatabase(() => {
    const contractor = createContractor({ name: "Sam", position: "Engineer", country: "India", managerId: null });

    const preview = reconcile([row({ employeeId: "E-12", name: "Spreadsheet Name" })], { commit: false }, NOW);
    assert.deepEqual(preview, { added: 1, updated: 0, inactivated: 0 });
    assert.equal(getEmployeeById("E-12"), null);

    const committed = reconcile([row({ employeeId: "E-12", name: "Spreadsheet Name" })], { commit: true }, NOW);
    assert.deepEqual(committed, { added: 1, updated: 0, inactivated: 0 });
    assert.equal(getEmployeeById("E-12")?.name, "Spreadsheet Name");
    assert.equal(getEmployeeById(contractor.id)?.name, "Sam");
  });
});

test("spec 012: imported supervisor relationships ignore manually managed contractors", () => {
  withFreshDatabase(() => {
    createContractor({ name: "Sam", position: "Engineer", country: "India", managerId: null });
    reconcile(
      [
        row({ employeeId: "E-12", name: "Sam Spreadsheet" }),
        row({ employeeId: "E-13", supervisorId: "E-12", supervisorName: "Sam Spreadsheet" }),
      ],
      { commit: true },
      NOW,
    );
    assert.equal(getEmployeeById("E-13")?.managerId, "E-12");
    assert.equal(getEmployeeById("E-13")?.externalManagerId, null);
  });
});

test("FR-2.1: a soft-inactivated employee who reappears is reactivated", () => {
  withFreshDatabase(() => {
    reconcile([row()], { commit: true }, NOW);
    reconcile([], { commit: true }, NOW); // 1001 absent -> inactivated
    assert.equal(getEmployeeById("1001")?.endDate, "2026-06-15");

    reconcile([row()], { commit: true }, new Date("2026-07-01T00:00:00.000Z"));
    assert.equal(getEmployeeById("1001")?.endDate, null);
  });
});

test("FR-2.2: an unresolvable supervisor id leaves managerId null without aborting", () => {
  withFreshDatabase(() => {
    reconcile([row({ supervisorId: "no-such-manager" })], { commit: true }, NOW);
    assert.equal(getEmployeeById("1001")?.managerId, null);
  });
});

test("FR-2.2: a resolvable supervisor id sets managerId", () => {
  withFreshDatabase(() => {
    reconcile(
      [row({ employeeId: "mgr-1", supervisorId: null }), row({ employeeId: "1001", supervisorId: "mgr-1" })],
      { commit: true },
      NOW,
    );
    assert.equal(getEmployeeById("1001")?.managerId, "mgr-1");
  });
});

test("FR-2.2: a blank supervisor id (null) requires no lookup and always succeeds", () => {
  withFreshDatabase(() => {
    assert.doesNotThrow(() => reconcile([row({ supervisorId: null })], { commit: true }, NOW));
  });
});

test("FR-2.2: multiple rows referencing the same unresolved supervisor id/name produce exactly one external_managers row", () => {
  withFreshDatabase(() => {
    reconcile(
      [
        row({ employeeId: "1001", supervisorId: "ext-1", supervisorName: "Frank Borg" }),
        row({ employeeId: "1002", supervisorId: "ext-1", supervisorName: "Frank Borg" }),
        row({ employeeId: "1003", supervisorId: "ext-1", supervisorName: "Frank Borg" }),
      ],
      { commit: true },
      NOW,
    );
    const externalManagers = getAllExternalManagers().filter((manager) => manager.id === "ext-1");
    assert.equal(externalManagers.length, 1);
    assert.equal(externalManagers[0].name, "Frank Borg");
  });
});

test("FR-2.2: a tie in name frequency for one unresolved id resolves deterministically via localeCompare", () => {
  withFreshDatabase(() => {
    reconcile(
      [
        row({ employeeId: "1001", supervisorId: "ext-1", supervisorName: "Bob" }),
        row({ employeeId: "1002", supervisorId: "ext-1", supervisorName: "Alice" }),
      ],
      { commit: true },
      NOW,
    );
    const externalManagers = getAllExternalManagers().filter((manager) => manager.id === "ext-1");
    assert.equal(externalManagers.length, 1);
    assert.equal(externalManagers[0].name, "Alice");
  });
});

test("FR-2.3: an unresolved supervisor id with no name anywhere in the batch leaves managerId and externalManagerId null, and writes no external_managers row", () => {
  withFreshDatabase(() => {
    reconcile([row({ employeeId: "1001", supervisorId: "ext-1", supervisorName: null })], { commit: true }, NOW);
    const employee = getEmployeeById("1001");
    assert.equal(employee?.managerId, null);
    assert.equal(employee?.externalManagerId, null);
    assert.equal(getAllExternalManagers().filter((manager) => manager.id === "ext-1").length, 0);
  });
});

test("FR-2.3: a supervisor id that resolves to a real active employee sets managerId and clears externalManagerId, self-healing a stale external link", () => {
  withFreshDatabase(() => {
    // First import: "mgr-1" is unresolved but has a name, so 1001 links externally.
    reconcile(
      [row({ employeeId: "1001", supervisorId: "mgr-1", supervisorName: "Frank Borg" })],
      { commit: true },
      NOW,
    );
    assert.equal(getEmployeeById("1001")?.managerId, null);
    assert.equal(getEmployeeById("1001")?.externalManagerId, "mgr-1");

    // Second import: "mgr-1" now has a real row, so 1001's external link must clear.
    reconcile(
      [
        row({ employeeId: "mgr-1", name: "Frank Borg", supervisorId: null, supervisorName: null }),
        row({ employeeId: "1001", supervisorId: "mgr-1", supervisorName: "Frank Borg" }),
      ],
      { commit: true },
      NOW,
    );
    assert.equal(getEmployeeById("1001")?.managerId, "mgr-1");
    assert.equal(getEmployeeById("1001")?.externalManagerId, null);
  });
});

test("FR-2.3: a supervisor id that resolves to a real but INACTIVE employee still sets managerId, unchanged pre-existing behavior (Out of Scope)", () => {
  withFreshDatabase(() => {
    reconcile([row({ employeeId: "mgr-1", supervisorId: null, supervisorName: null })], { commit: true }, NOW);
    reconcile([], { commit: true }, NOW); // mgr-1 absent -> soft-inactivated
    assert.equal(getEmployeeById("mgr-1")?.endDate, "2026-06-15");

    reconcile(
      [row({ employeeId: "1001", supervisorId: "mgr-1", supervisorName: "Someone Else" })],
      { commit: true },
      NOW,
    );
    assert.equal(getEmployeeById("1001")?.managerId, "mgr-1");
    assert.equal(getEmployeeById("1001")?.externalManagerId, null);
  });
});

test("FR-2.3: an employee absent from a later import is soft-inactivated, not deleted, preserving history", () => {
  withFreshDatabase(() => {
    reconcile([row()], { commit: true }, NOW);
    const counts = reconcile([], { commit: true }, NOW);
    assert.deepEqual(counts, { added: 0, updated: 0, inactivated: 1 });
    const employee = getEmployeeById("1001");
    assert.ok(employee);
    assert.equal(employee?.endDate, "2026-06-15");
    assert.equal(getSalaryHistory("1001").length, 1);
    assert.equal(getRatingHistory("1001").length, 1);
  });
});

test("FR-2.3: an already-inactive employee's end_date is never overwritten by a later import", () => {
  withFreshDatabase(() => {
    reconcile([row()], { commit: true }, NOW);
    reconcile([], { commit: true }, NOW);
    const laterDate = new Date("2026-09-01T00:00:00.000Z");
    const counts = reconcile([], { commit: true }, laterDate);
    assert.equal(counts.inactivated, 0);
    assert.equal(getEmployeeById("1001")?.endDate, "2026-06-15");
  });
});

test("FR-1.5, FR-3.1: salary and rating rows are written for the effective year of the captured instant", () => {
  withFreshDatabase(() => {
    reconcile([row({ ratings: { "Most Recent": "Exceeds", "Prior Rating": "Meets" } })], { commit: true }, NOW);
    const salary = getSalaryHistory("1001");
    assert.equal(salary.length, 1);
    assert.equal(salary[0].effectiveYear, 2026);
    const ratings = getRatingHistory("1001");
    assert.deepEqual(
      ratings.map((r) => r.ratingPeriod),
      ["Most Recent", "Prior Rating"],
    );
  });
});

test("AR-2.3: a mapped compRatio flows through to the written salary_history row, unrounded", () => {
  withFreshDatabase(() => {
    reconcile([row({ compRatio: 1.141603 })], { commit: true }, NOW);
    const salary = getSalaryHistory("1001");
    assert.equal(salary.length, 1);
    assert.equal(salary[0].compRatio, 1.141603);
  });
});

test("FR-2.2: a null compRatio writes a null comp_ratio alongside populated currency/baseSalary/bonus", () => {
  withFreshDatabase(() => {
    reconcile([row({ compRatio: null })], { commit: true }, NOW);
    const [salary] = getSalaryHistory("1001");
    assert.equal(salary.compRatio, null);
    assert.equal(salary.currency, "USD");
    assert.equal(salary.baseSalary, 100000);
    assert.equal(salary.bonus, 10000);
  });
});

test("FR-2.2: re-importing without the Base Pay Compa Ratio column clears a previously-written comp_ratio", () => {
  withFreshDatabase(() => {
    reconcile([row({ compRatio: 1.141603 })], { commit: true }, NOW);
    reconcile([row({ compRatio: null })], { commit: true }, NOW);
    const [salary] = getSalaryHistory("1001");
    assert.equal(salary.compRatio, null);
    assert.equal(salary.baseSalary, 100000);
  });
});

test("FR-3.3: a rating period that goes blank on reimport is removed", () => {
  withFreshDatabase(() => {
    reconcile([row({ ratings: { "Most Recent": "Exceeds", "Two Year Prior Rating": "Meets" } })], { commit: true }, NOW);
    reconcile([row({ ratings: { "Most Recent": "Exceeds" } })], { commit: true }, NOW);
    assert.deepEqual(
      getRatingHistory("1001").map((r) => r.ratingPeriod),
      ["Most Recent"],
    );
  });
});

test("FR-5.1: a supervisor chain forming a cycle aborts the whole reconciliation", () => {
  withFreshDatabase(() => {
    assert.throws(() =>
      reconcile(
        [
          row({ employeeId: "a", supervisorId: "b" }),
          row({ employeeId: "b", supervisorId: "a" }),
        ],
        { commit: true },
        NOW,
      ),
    );
    assert.equal(getEmployeeById("a"), null);
    assert.equal(getEmployeeById("b"), null);
  });
});

test("AR-5.1: a preview (commit: false) rolls back every write", () => {
  withFreshDatabase(() => {
    const counts = reconcile([row()], { commit: false }, NOW);
    assert.deepEqual(counts, { added: 1, updated: 0, inactivated: 0 });
    assert.equal(getEmployeeById("1001"), null);
    assert.equal(getAllEmployees().length, 0);
  });
});

test("FR-5.1: an invalid row aborts the whole reconciliation, leaving prior state untouched", () => {
  withFreshDatabase(() => {
    reconcile([row({ employeeId: "keep-me" })], { commit: true }, NOW);
    assert.throws(() =>
      reconcile(
        [row({ employeeId: "keep-me", position: "Should Not Apply" }), row({ employeeId: "bad-row", currency: "usd" })],
        { commit: true },
        NOW,
      ),
    );
    // The failed call's writes — including bad-row's insert and keep-me's
    // otherwise-valid re-upsert in the same batch — must be fully rolled
    // back, leaving only what the first, successful call committed.
    assert.equal(getEmployeeById("bad-row"), null);
    assert.equal(getEmployeeById("keep-me")?.position, "Engineer");
    assert.equal(getSalaryHistory("keep-me").length, 1);
  });
});
