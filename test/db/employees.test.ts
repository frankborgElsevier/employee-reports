import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteEmployee, upsertEmployee } from "../../src/db/mutations.js";
import { getAllEmployees, getEmployeeById } from "../../src/db/queries.js";
import { ConflictError, NotFoundError, ValidationError } from "../../src/db/errors.js";
import { reassignManager } from "../../src/db/mutations.js";
import { withFreshDatabase } from "./helpers.js";

test("FR-1.1: inserting an employee with a valid manager_id succeeds", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "mgr-1", name: "Alice", position: "Manager", country: "UK" });
    reassignManager("mgr-1", null);
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    reassignManager("emp-1", "mgr-1");
    assert.equal(getEmployeeById("emp-1")?.managerId, "mgr-1");
  });
});

test("FR-1.1: reassignManager to a non-existent employee id fails", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    assert.throws(() => reassignManager("emp-1", "ghost"), NotFoundError);
  });
});

test("FR-1.2: malformed calendar date is rejected", () => {
  withFreshDatabase(() => {
    assert.throws(
      () =>
        upsertEmployee({
          id: "emp-1",
          name: "Bob",
          position: "Engineer",
          country: "UK",
          endDate: "2025-13-40",
        }),
      ValidationError,
    );
  });
});

test("FR-1.2: blank name/id is rejected", () => {
  withFreshDatabase(() => {
    assert.throws(
      () => upsertEmployee({ id: "emp-1", name: "   ", position: "Engineer", country: "UK" }),
      ValidationError,
    );
    assert.throws(
      () => upsertEmployee({ id: "   ", name: "Bob", position: "Engineer", country: "UK" }),
      ValidationError,
    );
  });
});

test("FR-1.2: getAllEmployees() with no arguments returns only active employees", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "active-1", name: "Alice", position: "Engineer", country: "UK" });
    upsertEmployee({
      id: "left-1",
      name: "Bob",
      position: "Engineer",
      country: "UK",
      endDate: "2024-01-01",
    });
    const active = getAllEmployees();
    assert.deepEqual(
      active.map((e) => e.id),
      ["active-1"],
    );
  });
});

test("FR-4.3: upsertEmployee's input has no manager_id field, so it cannot change the manager", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "mgr-1", name: "Alice", position: "Manager", country: "UK" });
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    reassignManager("emp-1", "mgr-1");
    // Re-upserting the employee (e.g. a re-import) must not disturb manager_id.
    upsertEmployee({ id: "emp-1", name: "Bob Jr.", position: "Engineer", country: "US" });
    assert.equal(getEmployeeById("emp-1")?.managerId, "mgr-1");
  });
});

test("FR-1.6, FR-4.4: deleting an employee with direct reports fails", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "mgr-1", name: "Alice", position: "Manager", country: "UK" });
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    reassignManager("emp-1", "mgr-1");
    assert.throws(() => deleteEmployee("mgr-1"), ConflictError);
  });
});

test("FR-1.6, FR-4.4: deleting an employee with no direct reports removes their history rows", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
    deleteEmployee("emp-1");
    assert.equal(getEmployeeById("emp-1"), null);
  });
});

test("FR-4.4: deleting a non-existent employee throws", () => {
  withFreshDatabase(() => {
    assert.throws(() => deleteEmployee("ghost"), NotFoundError);
  });
});

test("AR-4.4: getEmployeeById returns null rather than throwing for an unknown id", () => {
  withFreshDatabase(() => {
    assert.equal(getEmployeeById("ghost"), null);
  });
});

test("FR-4.1: getAllEmployees is ordered by id lexicographically, not numerically", () => {
  withFreshDatabase(() => {
    for (const id of ["9", "10", "2"]) {
      upsertEmployee({ id, name: id, position: "Engineer", country: "UK" });
    }
    // Lexicographic order: "10" < "2" < "9" (numeric order would be 2, 9, 10).
    assert.deepEqual(
      getAllEmployees().map((e) => e.id),
      ["10", "2", "9"],
    );
  });
});
