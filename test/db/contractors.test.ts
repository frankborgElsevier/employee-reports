import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createContractor,
  deleteContractor,
  getActiveContractors,
  getCurrentManagerOptions,
  getEmployeeById,
  reassignManager,
  setContractorManager,
  updateContractorDetails,
  upsertEmployee,
} from "../../src/db/index.js";
import { NotFoundError, ValidationError } from "../../src/db/errors.js";
import { withFreshDatabase } from "./helpers.js";

function addCurrentManager(): void {
  upsertEmployee({ id: "manager", name: "Alex", position: "Engineering Manager", country: "United Kingdom" });
  upsertEmployee({ id: "report", name: "Sam", position: "Engineer", country: "India" });
  reassignManager("report", "manager");
}

test("spec 012: contractors retain manual details and only an imported employee manager reference", () => {
  withFreshDatabase(() => {
    addCurrentManager();
    const contractor = createContractor({ name: " Sam ", position: " Engineer ", country: " India ", managerId: "manager" });
    assert.match(contractor.id, /^contractor:/);
    assert.deepEqual(getEmployeeById(contractor.id), {
      id: contractor.id, name: "Sam", position: "Engineer", country: "India", workerType: "contractor",
      endDate: null, managerId: "manager", externalManagerId: null,
    });
  });
});

test("spec 012: manager changes revalidate eligibility and detail changes retain manager atomically", () => {
  withFreshDatabase(() => {
    addCurrentManager();
    const contractor = createContractor({ name: "Sam", position: "Engineer", country: "India", managerId: "manager" });
    const updated = updateContractorDetails(contractor.id, { name: "Sam Taylor", position: "Staff Engineer", country: "India" });
    assert.equal(updated.managerId, "manager");
    assert.throws(() => setContractorManager(contractor.id, "report"), ValidationError);
    assert.equal(getEmployeeById(contractor.id)?.managerId, "manager");
    assert.deepEqual(getActiveContractors().map((entry) => entry.id), [contractor.id]);
  });
});

test("spec 012: manager options exclude external managers and exact duplicate human labels are unavailable", () => {
  withFreshDatabase(() => {
    for (const id of ["a", "b"]) {
      upsertEmployee({ id, name: "Alex Morgan", position: "Manager", country: "UK" });
      upsertEmployee({ id: `report-${id}`, name: `Report ${id}`, position: "Engineer", country: "UK" });
      reassignManager(`report-${id}`, id);
    }
    assert.deepEqual(getCurrentManagerOptions(), [
      { id: "a", name: "Alex Morgan", position: "Manager", country: "UK", selectable: false },
      { id: "b", name: "Alex Morgan", position: "Manager", country: "UK", selectable: false },
    ]);
  });
});

test("spec 012: deleteContractor cannot delete an imported employee and is idempotently safe", () => {
  withFreshDatabase(() => {
    const contractor = createContractor({ name: "Sam", position: "Engineer", country: "India" });
    upsertEmployee({ id: "employee", name: "Eli", position: "Engineer", country: "UK" });
    deleteContractor(contractor.id);
    assert.equal(getEmployeeById(contractor.id), null);
    assert.ok(getEmployeeById("employee"));
    assert.throws(() => deleteContractor(contractor.id), NotFoundError);
    assert.throws(() => deleteContractor("employee"), NotFoundError);
  });
});
