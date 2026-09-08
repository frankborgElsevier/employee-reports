import assert from "node:assert/strict";
import { test } from "node:test";
import { contractorDetailsRequestFromForm, contractorManagerRequestFromForm, contractorRequestFromForm, isCreatedContractor, isValidContractorList, isValidManagerOptions, managerChoices } from "../../public/contractorLogic.js";

test("spec 012: manager options contain opaque references and human context", () => {
  const managers = [
    { id: "employee:one", name: "Alex Morgan", position: "Engineering Manager", country: "United Kingdom", selectable: true },
    { id: "employee:two", name: "Alex Morgan", position: "Product Manager", country: "United Kingdom", selectable: true },
  ];
  assert.equal(isValidManagerOptions({ managers, positions: ["Engineer"] }), true);
  assert.equal(isValidManagerOptions({ managers: [{ ...managers[0], selectable: "yes" }], positions: ["Engineer"] }), false);
  assert.deepEqual(managerChoices(managers), [
    { id: "employee:one", label: "Alex Morgan — Engineering Manager, United Kingdom", available: true, unresolved: false },
    { id: "employee:two", label: "Alex Morgan — Product Manager, United Kingdom", available: true, unresolved: false },
  ]);
});

test("spec 012: indistinguishable manager choices are unavailable without exposing IDs", () => {
  const choices = managerChoices([
    { id: "private-one", name: "Alex Morgan", position: "Manager", country: "UK", selectable: true },
    { id: "private-two", name: "Alex Morgan", position: "Manager", country: "UK", selectable: true },
  ]);
  assert.deepEqual(choices.map(({ label, available, unresolved }) => ({ label, available, unresolved })), [
    { label: "Alex Morgan — Manager, UK", available: false, unresolved: true },
    { label: "Alex Morgan — Manager, UK", available: false, unresolved: true },
  ]);
});

test("spec 012: an ineligible saved manager remains the disabled current choice", () => {
  const choices = managerChoices([], { id: "private-manager", name: "Alex Morgan", position: "Manager", country: "UK" });
  assert.deepEqual(choices, [
    { id: "private-manager", label: "Alex Morgan — Manager, UK (no longer current)", available: false, unresolved: false },
  ]);
});

test("spec 012: requests trim manual fields and submit only selected manager reference", () => {
  assert.deepEqual(contractorRequestFromForm({ name: " Sam ", position: " Engineer ", country: " India ", managerId: " employee:alex " }), { name: "Sam", position: "Engineer", country: "India", managerId: "employee:alex" });
  assert.deepEqual(contractorDetailsRequestFromForm({ name: " Sam ", position: " Engineer ", country: " India " }), { name: "Sam", position: "Engineer", country: "India" });
  assert.deepEqual(contractorManagerRequestFromForm({ managerId: "" }), { managerId: null });
});

test("spec 012: list and mutation response validation has no contractor WorkDay state", () => {
  const contractor = { id: "contractor:one", name: "Sam", position: "Engineer", country: "India", manager: { id: "employee:manager", name: "Alex", position: "Manager", country: "UK" } };
  assert.equal(isValidContractorList({ contractors: [contractor] }), true);
  assert.equal(isCreatedContractor({ contractor }), true);
  assert.equal(isValidContractorList({ contractors: [{ id: "employee:one" }] }), false);
});
