import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { closeDatabase } from "../../src/db/connection.js";
import {
  createContractor,
  reassignManager,
  setExternalManager,
  upsertEmployee,
  upsertExternalManager,
} from "../../src/db/index.js";
import { withTestServer } from "./helpers.js";

interface HeadcountEntry {
  id: string;
  name: string;
  position: string | null;
  country: string | null;
  managerId: string | null;
  isExternal: boolean;
  isContractor: boolean;
}

function seedEmployee(id: string, name: string, country = "United Kingdom"): void {
  upsertEmployee({ id, name, position: "Software Engineer II", country });
}

describe("GET /api/headcount", () => {
  it("spec 007: returns every active worker with explicit external and contractor flags", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      seedEmployee("b", "Ben");
      reassignManager("b", "a");

      const response = await fetch(`${baseUrl}/api/headcount`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as { employees: HeadcountEntry[] };
      assert.equal(body.employees.length, 2);
      // FR-3.2: asserted on the key set, not as a substring search over the
      // serialised body — an employee legitimately named "Currency" would fail
      // that, and it would miss a field leaked under another name.
      for (const entry of body.employees) {
        assert.deepEqual(Object.keys(entry).sort(), [
          "country",
          "id",
          "isContractor",
          "isExternal",
          "managerId",
          "name",
          "position",
        ]);
      }
      assert.equal(body.employees[1].managerId, "a");
    });
  });

  it("FR-3.1: `endDate` is never serialised, even though the row carries one", async () => {
    await withTestServer(async ({ baseUrl }) => {
      upsertEmployee({
        id: "a",
        name: "Ana",
        position: "Software Engineer II",
        country: "United Kingdom",
        endDate: null,
      });

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };
      assert.ok(!("endDate" in body.employees[0]));
    });
  });

  it("FR-1.1: inactive employees are excluded", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      upsertEmployee({
        id: "b",
        name: "Ben",
        position: "Software Engineer II",
        country: "India",
        endDate: "2026-08-01",
      });

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };
      assert.deepEqual(
        body.employees.map((entry) => entry.id),
        ["a"],
      );
    });
  });

  it("FR-3.1: an empty database returns an empty array, not an error", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/headcount`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { employees: [] });
    });
  });

  it("FR-3.1: entries arrive in id order", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("c", "Cleo");
      seedEmployee("a", "Ana");
      seedEmployee("b", "Ben");

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };
      assert.deepEqual(
        body.employees.map((entry) => entry.id),
        ["a", "b", "c"],
      );
    });
  });

  it("FR-2.4: an active employee's external manager reference is unified into `managerId` and the external manager appears as its own entry", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("b", "Ben");
      upsertExternalManager("ext1", "Frank Borg");
      setExternalManager("b", "ext1");

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };

      const realEntry = body.employees.find((entry) => entry.id === "b");
      assert.deepEqual(realEntry, {
        id: "b",
        name: "Ben",
        position: "Software Engineer II",
        country: "United Kingdom",
        managerId: "ext1",
        isExternal: false,
        isContractor: false,
      });

      const externalEntries = body.employees.filter((entry) => entry.isExternal);
      assert.deepEqual(externalEntries, [
        {
          id: "ext1",
          name: "Frank Borg",
          position: null,
          country: null,
          managerId: null,
          isExternal: true,
          isContractor: false,
        },
      ]);
      // The external entry is appended after every real employee entry.
      assert.equal(body.employees[body.employees.length - 1].id, "ext1");
    });
  });

  it("FR-2.4: an external manager row not referenced by any active employee is omitted from the response", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      upsertExternalManager("ext1", "Frank Borg");

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };

      assert.deepEqual(
        body.employees.map((entry) => entry.id),
        ["a"],
      );
    });
  });

  it("FR-2.4: real employees keep id-ascending order, with the referenced external manager appended after them", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("c", "Cleo");
      seedEmployee("a", "Ana");
      seedEmployee("b", "Ben");
      upsertExternalManager("ext1", "Frank Borg");
      setExternalManager("a", "ext1");

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };

      assert.deepEqual(
        body.employees.map((entry) => entry.id),
        ["a", "b", "c", "ext1"],
      );
    });
  });

  it("FR-2.4: an external id colliding with a real active employee id yields exactly one entry, the real one", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      seedEmployee("z", "Zara");
      upsertExternalManager("a", "Some External Name");
      setExternalManager("z", "a");

      const response = await fetch(`${baseUrl}/api/headcount`);
      const body = (await response.json()) as { employees: HeadcountEntry[] };

      const entriesWithIdA = body.employees.filter((entry) => entry.id === "a");
      assert.equal(entriesWithIdA.length, 1);
      assert.equal(entriesWithIdA[0]?.isExternal, false);
      assert.equal(entriesWithIdA[0]?.name, "Ana");
    });
  });

  it("AR-3.2: no Origin header is required, unlike the import routes", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/headcount`);
      assert.equal(response.status, 200);
      // AR-3.2: and no CORS headers are added.
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
  });

  it("AR-3.4: a data-layer failure returns 500 with a fixed, generic message", async () => {
    await withTestServer(async ({ baseUrl }) => {
      // No injection seam needed: closeDatabase() is safe to call at any time,
      // and getConnection() throws once no connection is open. withTestServer's
      // own cleanup closes again harmlessly.
      closeDatabase();

      const response = await fetch(`${baseUrl}/api/headcount`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Could not load employee data." });
    });
  });
});

describe("GET / landing page", () => {
  it("sends a first-time user to Import when no active people exist", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/index.html");
    });
  });

  it("sends a returning user to Headcount when active people exist", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/headcount.html");
    });
  });

  it("sends a contractor-only database to Headcount", async () => {
    await withTestServer(async ({ baseUrl }) => {
      createContractor({ name: "Sam", position: "Engineer", country: "India", manager: null });
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/headcount.html");
    });
  });
});

describe("dashboard page", () => {
  it("FR-3.3: /headcount.html is served as HTML by the existing static middleware", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/headcount.html`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    });
  });

  it("AR-2.3: the chart-logic module is served so the browser can import it", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/chart-logic.js`);
      assert.equal(response.status, 200);
    });
  });

  it("FR-3.5: the dashboard links directly to Import and marks Headcount as current", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const dashboardPage = await (await fetch(`${baseUrl}/headcount.html`)).text();
      assert.match(dashboardPage, /<a href="\/index\.html">Import<\/a>/);
      assert.match(dashboardPage, /<a href="\/headcount\.html" aria-current="page">Headcount<\/a>/);
    });
  });

  it("FR-1.7: the three bucket colours are the contrast-checked hex values", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const page = await (await fetch(`${baseUrl}/headcount.html`)).text();
      assert.match(page, /\.card\.blue \{ background: #d6e4f7; \}/);
      assert.match(page, /\.card\.red \{ background: #f7d6d6; \}/);
      assert.match(page, /\.card\.green \{ background: #d9f0dc; \}/);
      assert.match(page, /color: #1a1a1a/);
      assert.match(page, /Blue — UK &amp; US/);
      assert.match(page, /Red — India/);
      assert.match(page, /Green — all other countries/);
    });
  });

  it("spec 010 FR-3.1: the served page excludes the Team breakdown", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const page = await (await fetch(`${baseUrl}/headcount.html`)).text();
      assert.doesNotMatch(page, /Team breakdown/);
      assert.doesNotMatch(page, /locationRoleBreakdown/);
    });
  });

  it("FR-3.6: the import screen links onward to the dashboard after a successful import", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const page = await (await fetch(`${baseUrl}/`)).text();
      assert.match(page, /dashboardLink\.href = "\/headcount\.html"/);
      assert.match(page, /dashboardLink\.textContent = "View the Headcount dashboard"/);
    });
  });
});
