import assert from "node:assert/strict";
import { test } from "node:test";
import { CycleError } from "../../src/db/errors.js";
import { reassignManager, upsertEmployee } from "../../src/db/mutations.js";
import { getAncestors, getDescendants, getEmployeeById } from "../../src/db/queries.js";
import { withFreshDatabase } from "./helpers.js";

function seedChain(): void {
  // A -> B -> C (A manages B, B manages C)
  for (const id of ["a", "b", "c"]) {
    upsertEmployee({ id, name: id.toUpperCase(), position: "Engineer", country: "UK" });
  }
  reassignManager("b", "a");
  reassignManager("c", "b");
}

test("FR-1.3: an employee with manager_id = NULL is a hierarchy root", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "root", name: "Root", position: "CEO", country: "UK" });
    assert.equal(getEmployeeById("root")?.managerId, null);
    assert.deepEqual(
      getDescendants("root").map((e) => e.id),
      [],
    );
  });
});

test("FR-1.4: a direct self-reference is rejected", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "a", name: "A", position: "Engineer", country: "UK" });
    assert.throws(() => reassignManager("a", "a"), CycleError);
  });
});

test("FR-1.4: a transitive cycle is rejected before any row is written", () => {
  withFreshDatabase(() => {
    seedChain();
    // a -> b -> c already exists; making a report to c would close the loop.
    assert.throws(() => reassignManager("a", "c"), CycleError);
    assert.equal(getEmployeeById("a")?.managerId, null);
  });
});

test("FR-1.5: descendants are ordered by depth ascending, excluding the starting employee", () => {
  withFreshDatabase(() => {
    seedChain();
    const descendants = getDescendants("a").map((e) => e.id);
    assert.deepEqual(descendants, ["b", "c"]);
  });
});

test("FR-1.5: ancestors are ordered from nearest manager to most senior, excluding self", () => {
  withFreshDatabase(() => {
    seedChain();
    const ancestors = getAncestors("c").map((e) => e.id);
    assert.deepEqual(ancestors, ["b", "a"]);
  });
});

test("FR-1.5: includeInactive filters returned rows only; traversal still reaches active descendants behind an inactive manager", () => {
  withFreshDatabase(() => {
    seedChain();
    // b becomes inactive but c (still active) reports through b.
    upsertEmployee({
      id: "b",
      name: "B",
      position: "Engineer",
      country: "UK",
      endDate: "2024-01-01",
    });
    const defaultView = getDescendants("a").map((e) => e.id);
    assert.deepEqual(defaultView, ["c"]);

    const fullView = getDescendants("a", { includeInactive: true }).map((e) => e.id);
    assert.deepEqual(fullView, ["b", "c"]);
  });
});

test("FR-1.5: same-depth siblings are ordered by id ascending", () => {
  withFreshDatabase(() => {
    upsertEmployee({ id: "mgr", name: "Mgr", position: "Manager", country: "UK" });
    upsertEmployee({ id: "zed", name: "Zed", position: "Engineer", country: "UK" });
    upsertEmployee({ id: "amy", name: "Amy", position: "Engineer", country: "UK" });
    reassignManager("zed", "mgr");
    reassignManager("amy", "mgr");
    assert.deepEqual(
      getDescendants("mgr").map((e) => e.id),
      ["amy", "zed"],
    );
  });
});

test("AR-4.4: getDescendants/getAncestors return an empty array for an unknown id", () => {
  withFreshDatabase(() => {
    assert.deepEqual(getDescendants("ghost"), []);
    assert.deepEqual(getAncestors("ghost"), []);
  });
});
