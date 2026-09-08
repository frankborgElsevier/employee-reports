import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCreatedContractor, isValidContractorList, isValidManagerOptions } from "../../public/contractorLogic.js";
import { createContractor, reassignManager, setExternalManager, upsertEmployee, upsertExternalManager } from "../../src/db/index.js";
import { reconcile } from "../../src/import/reconcile.js";
import { withTestServer } from "./helpers.js";

function originHeaders(baseUrl: string): Record<string, string> {
  return { Origin: baseUrl, "Content-Type": "application/json" };
}

async function addImportedManager(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/api/contractors`); // ensure server/database lifecycle is active before direct mutations
  upsertEmployee({ id: "manager", name: "Alex Morgan", position: "Manager", country: "United Kingdom" });
  upsertEmployee({ id: "report", name: "Rita", position: "Engineer", country: "India" });
  reassignManager("report", "manager");
}

describe("contractor routes (spec 012)", () => {
  it("returns imported manager choices with human context and excludes external managers", async () => {
    await withTestServer(async ({ baseUrl }) => {
      await addImportedManager(baseUrl);
      upsertEmployee({ id: "external-report", name: "Eli", position: "Engineer", country: "India" });
      upsertExternalManager("frank", "Frank Borg");
      setExternalManager("external-report", "frank");
      const response = await fetch(`${baseUrl}/api/contractor-form-options`);
      const body = await response.json();
      assert.equal(isValidManagerOptions(body), true);
      assert.deepEqual(body, {
        managers: [{ id: "manager", name: "Alex Morgan", position: "Manager", country: "United Kingdom", selectable: true }],
        positions: ["Engineer", "Manager"],
      });
    });
  });

  it("creates, lists, edits, and reassigns contractors without WorkDay fields", async () => {
    await withTestServer(async ({ baseUrl }) => {
      await addImportedManager(baseUrl);
      const created = await fetch(`${baseUrl}/api/contractors`, {
        method: "POST", headers: originHeaders(baseUrl),
        body: JSON.stringify({ name: "Sam", position: "Engineer", country: "India", managerId: "manager" }),
      });
      assert.equal(created.status, 201);
      const createdBody = await created.json();
      assert.equal(isCreatedContractor(createdBody), true);
      const { contractor } = createdBody;
      assert.deepEqual(contractor.manager, { id: "manager", name: "Alex Morgan", position: "Manager", country: "United Kingdom" });
      assert.equal(contractor.workdayWorkerId, undefined);
      assert.equal(contractor.matchStatus, undefined);

      const listed = await fetch(`${baseUrl}/api/contractors`);
      const listedBody = await listed.json();
      assert.equal(isValidContractorList(listedBody), true);

      const details = await fetch(`${baseUrl}/api/contractors/${encodeURIComponent(contractor.id)}/details`, {
        method: "PUT", headers: originHeaders(baseUrl), body: JSON.stringify({ name: "Sam Taylor", position: "Senior Engineer", country: "India" }),
      });
      assert.equal(details.status, 200);
      const detailsBody = await details.json();
      assert.equal(isCreatedContractor(detailsBody), true);
      assert.equal(detailsBody.contractor.name, "Sam Taylor");

      const manager = await fetch(`${baseUrl}/api/contractors/${encodeURIComponent(contractor.id)}/manager`, {
        method: "PUT", headers: originHeaders(baseUrl), body: JSON.stringify({ managerId: null }),
      });
      assert.equal(manager.status, 200);
      const managerBody = await manager.json();
      assert.equal(isCreatedContractor(managerBody), true);
      assert.equal(managerBody.contractor.manager, null);
    });
  });

  it("preserves an inactive imported manager for display but rejects reselecting it", async () => {
    await withTestServer(async ({ baseUrl }) => {
      await addImportedManager(baseUrl);
      const contractor = createContractor({ name: "Sam", position: "Engineer", country: "India", managerId: "manager" });
      reconcile([], { commit: true }, new Date("2026-09-07T12:00:00.000Z"));
      const listed = await (await fetch(`${baseUrl}/api/contractors`)).json();
      assert.equal(listed.contractors[0].manager.name, "Alex Morgan");
      const rejected = await fetch(`${baseUrl}/api/contractors/${encodeURIComponent(contractor.id)}/manager`, {
        method: "PUT", headers: originHeaders(baseUrl), body: JSON.stringify({ managerId: "manager" }),
      });
      assert.deepEqual(await rejected.json(), { error: "That line manager is no longer current. Reload the manager options and choose a current manager." });
    });
  });

  it("deletes only an addressed active contractor", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const created = await fetch(`${baseUrl}/api/contractors`, {
        method: "POST", headers: originHeaders(baseUrl), body: JSON.stringify({ name: "Sam", position: "Engineer", country: "India", managerId: null }),
      });
      const { contractor } = await created.json();
      const deleted = await fetch(`${baseUrl}/api/contractors/${encodeURIComponent(contractor.id)}`, { method: "DELETE", headers: { Origin: baseUrl } });
      assert.equal(deleted.status, 204);
      assert.equal((await (await fetch(`${baseUrl}/api/contractors`)).json()).contractors.length, 0);
      const repeated = await fetch(`${baseUrl}/api/contractors/${encodeURIComponent(contractor.id)}`, { method: "DELETE", headers: { Origin: baseUrl } });
      assert.equal(repeated.status, 404);
    });
  });

  it("returns fixed safe errors for malformed, invalid, stale, and cross-origin requests", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const malformed = await fetch(`${baseUrl}/api/contractors`, { method: "POST", headers: originHeaders(baseUrl), body: "{" });
      assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON." });
      const invalid = await fetch(`${baseUrl}/api/contractors`, { method: "POST", headers: originHeaders(baseUrl), body: JSON.stringify({ name: "", position: "Engineer", country: "India", managerId: null }) });
      assert.deepEqual(await invalid.json(), { error: "Enter a name, position, and country." });
      const crossOrigin = await fetch(`${baseUrl}/api/contractors`, { method: "POST", headers: { Origin: "http://example.test", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sam", position: "Engineer", country: "India", managerId: null }) });
      assert.equal(crossOrigin.status, 403);
    });
  });
});
