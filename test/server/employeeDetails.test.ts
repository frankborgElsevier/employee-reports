import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isValidPayload } from "../../public/employeeDetailsLogic.js";
import { closeDatabase } from "../../src/db/connection.js";
import { createContractor, reassignManager, upsertEmployee, upsertRatingRecord, upsertSalaryRecord } from "../../src/db/index.js";
import { withTestServer } from "./helpers.js";

interface EmployeeDetailsEntry {
  id: string;
  name: string;
  position: string;
  workerType: "employee" | "contractor";
  managerId: string | null;
  currency: string | null;
  baseSalary: number | null;
  bonus: number | null;
  compRatio: number | null;
  ratings: { mostRecent: string | null; priorRating: string | null; twoYearPriorRating: string | null };
}

function seedEmployee(id: string, name: string): void {
  upsertEmployee({ id, name, position: "Software Engineer II", country: "United Kingdom" });
}

describe("GET /api/employee-details", () => {
  it("spec 007: returns every active worker with workerType and three ratings keys", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      upsertSalaryRecord("a", 2026, "GBP", 60000, 500, 1.141603);
      upsertRatingRecord("a", "Most Recent", "Exceeds Expectations");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.equal(isValidPayload(body), true);
      assert.equal(body.employees.length, 1);
      const [entry] = body.employees;
      assert.deepEqual(Object.keys(entry).sort(), [
        "baseSalary",
        "bonus",
        "compRatio",
        "currency",
        "id",
        "managerId",
        "name",
        "position",
        "ratings",
        "workerType",
      ]);
      assert.deepEqual(Object.keys(entry.ratings).sort(), ["mostRecent", "priorRating", "twoYearPriorRating"]);
      assert.equal(entry.currency, "GBP");
      assert.equal(entry.baseSalary, 60000);
      assert.equal(entry.bonus, 500);
      assert.equal(entry.ratings.mostRecent, "Exceeds Expectations");
    });
  });

  it("FR-2.3: compRatio carries the stored value and sits between bonus and ratings in payload key order", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      upsertSalaryRecord("a", 2026, "GBP", 60000, 500, 1.141603);

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      const [entry] = body.employees;
      assert.equal(entry.compRatio, 1.141603);
      // Unsorted key order is the client's column-order convention (spec 004 FR-1.2).
      assert.deepEqual(Object.keys(entry), [
        "id",
        "name",
        "position",
        "workerType",
        "managerId",
        "currency",
        "baseSalary",
        "bonus",
        "compRatio",
        "ratings",
      ]);
    });
  });

  it("spec 007: returns contractors with unavailable WorkDay values and no history", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const contractor = createContractor({ name: "Sam", position: "Engineer", country: "India", manager: null });
      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.equal(isValidPayload(body), true);
      assert.deepEqual(body.employees, [
        {
          id: contractor.id,
          name: "Sam",
          position: "Engineer",
          workerType: "contractor",
          managerId: null,
          currency: null,
          baseSalary: null,
          bonus: null,
          compRatio: null,
          ratings: { mostRecent: null, priorRating: null, twoYearPriorRating: null },
        },
      ]);
    });
  });

  it("FR-2.3: an employee with no salary_history row shows compRatio null alongside currency/baseSalary/bonus all null", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.equal(isValidPayload(body), true);
      const [entry] = body.employees;
      assert.equal(entry.currency, null);
      assert.equal(entry.baseSalary, null);
      assert.equal(entry.bonus, null);
      assert.equal(entry.compRatio, null);
    });
  });

  it("FR-2.3: the mixed state — salary row present with comp_ratio NULL — shows compRatio null with the other three populated", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      // Written through the DB write API with compRatio omitted: the reference
      // .xlsx fixture has no blank cells in this column, so this state can only
      // be built synthetically (FR-2.2).
      upsertSalaryRecord("a", 2026, "GBP", 60000, 500);

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      const [entry] = body.employees;
      assert.equal(entry.currency, "GBP");
      assert.equal(entry.baseSalary, 60000);
      assert.equal(entry.bonus, 500);
      assert.equal(entry.compRatio, null);
    });
  });

  it("FR-4.1: an employee with no salary_history row has currency/baseSalary/bonus all null together", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.equal(body.employees[0].currency, null);
      assert.equal(body.employees[0].baseSalary, null);
      assert.equal(body.employees[0].bonus, null);
    });
  });

  it("FR-4.2: an employee with only a Most Recent rating maps to ratings.mostRecent, leaving the other two periods null", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      upsertRatingRecord("a", "Most Recent", "Meets Expectations");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.deepEqual(body.employees[0].ratings, {
        mostRecent: "Meets Expectations",
        priorRating: null,
        twoYearPriorRating: null,
      });
    });
  });

  it("FR-4.1: managerId reflects the employee's manager, or null with none", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("a", "Ana");
      seedEmployee("b", "Ben");
      reassignManager("b", "a");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      const byId = new Map(body.employees.map((entry) => [entry.id, entry]));
      assert.equal(byId.get("a")?.managerId, null);
      assert.equal(byId.get("b")?.managerId, "a");
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

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.deepEqual(body.employees.map((entry) => entry.id), ["a"]);
    });
  });

  it("FR-4.1: an empty database returns an empty array, not an error", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { employees: [] });
    });
  });

  it("FR-4.1: entries arrive in id order", async () => {
    await withTestServer(async ({ baseUrl }) => {
      seedEmployee("c", "Cleo");
      seedEmployee("a", "Ana");
      seedEmployee("b", "Ben");

      const response = await fetch(`${baseUrl}/api/employee-details`);
      const body = (await response.json()) as { employees: EmployeeDetailsEntry[] };
      assert.deepEqual(body.employees.map((entry) => entry.id), ["a", "b", "c"]);
    });
  });

  it("AR-4.1: no Origin header is required, and no CORS headers are added", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
  });

  it("AR-4.4: the 200 response carries Cache-Control: no-store", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  });

  it("AR-4.3: a data-layer failure returns 500 with a fixed, generic message", async () => {
    await withTestServer(async ({ baseUrl }) => {
      // No injection seam needed: closeDatabase() is safe to call at any
      // time, and getConnection() throws once no connection is open.
      closeDatabase();

      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Could not load employee data." });
    });
  });

  it("AR-4.4: the 500 response also carries Cache-Control: no-store — 'every response' includes the error path", async () => {
    await withTestServer(async ({ baseUrl }) => {
      closeDatabase();

      const response = await fetch(`${baseUrl}/api/employee-details`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  });
});

describe("employee details page", () => {
  it("FR-4.3: /employee-details.html is served as HTML by the existing static middleware", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/employee-details.html`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    });
  });

  it("AR-2.3: the employeeDetailsLogic module is served so the browser can import it", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/employeeDetailsLogic.js`);
      assert.equal(response.status, 200);
    });
  });

  it("spec 008 FR-2.1: the served page declares the performance and recency checklist labels", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const page = await (await fetch(`${baseUrl}/employee-details.html`)).text();
      assert.match(page, /Filter by performance rating/);
      assert.match(page, /Filter by rating recency/);
      assert.match(page, /PERFORMANCE_CATEGORIES/);
      assert.match(page, /RATING_PERIODS/);
    });
  });

  it("FR-4.5: reporting pages link directly to Import, marking the current page", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const importPage = await (await fetch(`${baseUrl}/index.html`)).text();
      assert.match(importPage, /<a href="\/index\.html" aria-current="page">Import<\/a>/);
      assert.match(importPage, /<a href="\/headcount\.html">Headcount<\/a>/);
      assert.match(importPage, /<a href="\/employee-details\.html">Employee Details<\/a>/);

      const dashboardPage = await (await fetch(`${baseUrl}/headcount.html`)).text();
      assert.match(dashboardPage, /<a href="\/index\.html">Import<\/a>/);
      assert.match(dashboardPage, /<a href="\/headcount\.html" aria-current="page">Headcount<\/a>/);
      assert.match(dashboardPage, /<a href="\/employee-details\.html">Employee Details<\/a>/);

      const detailsPage = await (await fetch(`${baseUrl}/employee-details.html`)).text();
      assert.match(detailsPage, /<a href="\/index\.html">Import<\/a>/);
      assert.match(detailsPage, /<a href="\/headcount\.html">Headcount<\/a>/);
      assert.match(
        detailsPage,
        /<a href="\/employee-details\.html" aria-current="page">Employee Details<\/a>/,
      );
    });
  });
});
