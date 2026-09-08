import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { createContractor, getEmployeeById } from "../../src/db/index.js";
import {
  resetForTesting,
  setReservationTimeoutMsForTesting,
  setTokenTtlMsForTesting,
  tryReserve,
} from "../../src/server/previewStore.js";
import { buildWorkbookFile, cleanupFile, defaultRow, writeRawFile } from "../import/helpers.js";
import { postConfirm, postPreview, withTestServer } from "./helpers.js";

test("FR-4.2, FR-4.3, FR-4.4: preview then confirm commits exactly the previewed counts", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const previewResponse = await postPreview(baseUrl, filePath);
      assert.equal(previewResponse.status, 200);
      const previewBody = await previewResponse.json();
      assert.equal(previewBody.outcome, "success");
      assert.deepEqual(previewBody.counts, { added: 1, updated: 0, inactivated: 0 });
      assert.ok(previewBody.token);

      // Nothing is committed by the preview alone (FR-4.3).
      assert.equal(getEmployeeById("1001"), null);

      const confirmResponse = await postConfirm(baseUrl, previewBody.token);
      assert.equal(confirmResponse.status, 200);
      const confirmBody = await confirmResponse.json();
      assert.equal(confirmBody.outcome, "success");
      assert.deepEqual(confirmBody.counts, { added: 1, updated: 0, inactivated: 0 });
      assert.equal(getEmployeeById("1001")?.name, "Alice Example");
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("spec 012: imports leave contractors untouched and return only employee reconciliation counts", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const contractor = createContractor({
      name: "Sam",
      position: "Engineer",
      country: "India",
      managerId: null,
    });
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const preview = await postPreview(baseUrl, filePath);
      assert.equal(preview.status, 200);
      const previewBody = await preview.json();
      assert.deepEqual(previewBody.counts, { added: 1, updated: 0, inactivated: 0 });
      assert.equal(previewBody.contractorsNeedingReview, undefined);
      assert.equal(getEmployeeById(contractor.id)?.name, "Sam");

      const confirmed = await postConfirm(baseUrl, previewBody.token);
      assert.equal(confirmed.status, 200);
      assert.deepEqual(await confirmed.json(), {
        outcome: "success",
        counts: { added: 1, updated: 0, inactivated: 0 },
      });
      assert.equal(getEmployeeById(contractor.id)?.name, "Sam");
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("AR-4.2: the retained upload is deleted after a successful confirm", async () => {
  await withTestServer(async ({ baseUrl, uploadDir }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const previewResponse = await postPreview(baseUrl, filePath);
      const previewBody = await previewResponse.json();
      assert.equal(fs.readdirSync(uploadDir).length, 1);
      await postConfirm(baseUrl, previewBody.token);
      assert.equal(fs.readdirSync(uploadDir).length, 0);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("AR-4.2: the retained upload is deleted after a failed preview", async () => {
  await withTestServer(async ({ baseUrl, uploadDir }) => {
    const filePath = await buildWorkbookFile([defaultRow({ "Worker Currency": "usd" })]);
    try {
      await postPreview(baseUrl, filePath);
      assert.equal(fs.readdirSync(uploadDir).length, 0);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("FR-4.3: a row-content problem is reported as a 200 failure outcome, with nothing committed", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow({ "Worker Currency": "usd" })]);
    try {
      const response = await postPreview(baseUrl, filePath);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.outcome, "failure");
      assert.ok(body.error);
      assert.equal(body.token, undefined);
      assert.equal(getEmployeeById("1001"), null);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("FR-4.3: a malformed workbook is rejected with 400, not a 200 failure outcome", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = writeRawFile("not a workbook");
    try {
      const response = await postPreview(baseUrl, filePath);
      assert.equal(response.status, 400);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("FR-5.2: a second preview while one is pending is rejected with 409", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const first = await postPreview(baseUrl, filePath);
      assert.equal(first.status, 200);
      const second = await postPreview(baseUrl, filePath);
      assert.equal(second.status, 409);
    } finally {
      // previewStore's pending-import guard is process-global (FR-5.2), so an
      // unconsumed preview from this test would otherwise leak into later
      // tests sharing this process.
      resetForTesting();
      cleanupFile(filePath);
    }
  });
});

test("FR-5.2: two truly concurrent preview requests — exactly one succeeds, the other gets 409", async () => {
  // Regression test for implementation-review.md's Finding 1: the guard must
  // be atomic against requests that race each other, not just requests sent
  // one after the other. Fired via Promise.all, with neither awaited first.
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const [first, second] = await Promise.all([postPreview(baseUrl, filePath), postPreview(baseUrl, filePath)]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409]);
    } finally {
      resetForTesting();
      cleanupFile(filePath);
    }
  });
});

test("FR-4.4: two truly concurrent confirms with the same token — exactly one commits", async () => {
  // Regression test for implementation-review.md's Finding 2.
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const previewResponse = await postPreview(baseUrl, filePath);
      const previewBody = await previewResponse.json();

      const [first, second] = await Promise.all([
        postConfirm(baseUrl, previewBody.token),
        postConfirm(baseUrl, previewBody.token),
      ]);
      const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

      const outcomes = [firstBody.outcome, secondBody.outcome];
      assert.equal(outcomes.filter((o) => o === "success").length, 1);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 400]);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("FR-5.2: an expired token releases the guard and lets a new preview succeed", async () => {
  setTokenTtlMsForTesting(1);
  try {
    await withTestServer(async ({ baseUrl }) => {
      const filePath = await buildWorkbookFile([defaultRow()]);
      try {
        const first = await postPreview(baseUrl, filePath);
        assert.equal(first.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const second = await postPreview(baseUrl, filePath);
        assert.equal(second.status, 200);
        const secondBody = await second.json();
        assert.equal(secondBody.outcome, "success");

        // Confirming the now-expired first token must fail.
        const firstBody = await first.json();
        const staleConfirm = await postConfirm(baseUrl, firstBody.token);
        assert.equal(staleConfirm.status, 400);
      } finally {
        resetForTesting();
        cleanupFile(filePath);
      }
    });
  } finally {
    setTokenTtlMsForTesting(null);
  }
});

test("FR-5.2: a reservation that never finalizes is reaped after its timeout, not blocked forever", async () => {
  // Regression test for implementation-review.md's Finding 4: fixing the
  // concurrent-request race (Finding 1) introduced a "computing" state with
  // no expiry, which could block every future import forever if a request
  // reserved the slot and then never completed (a stalled upload, a hung
  // parse). Simulates exactly that — a reservation with nothing ever calling
  // finalize or release — and confirms it's reaped rather than permanent.
  setReservationTimeoutMsForTesting(1);
  try {
    await withTestServer(async ({ baseUrl }) => {
      const filePath = await buildWorkbookFile([defaultRow()]);
      try {
        const stuckTicket = tryReserve();
        assert.ok(stuckTicket, "expected the slot to be free before this test's stuck reservation");

        await new Promise((resolve) => setTimeout(resolve, 10));

        const response = await postPreview(baseUrl, filePath);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.outcome, "success");
      } finally {
        resetForTesting();
        cleanupFile(filePath);
      }
    });
  } finally {
    setReservationTimeoutMsForTesting(null);
  }
});

test("FR-4.4: confirming with an unknown token is rejected with 400", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const response = await postConfirm(baseUrl, "not-a-real-token");
    assert.equal(response.status, 400);
  });
});

test("AR-4.3: a request with a missing Origin header is rejected with 403", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const response = await postPreview(baseUrl, filePath, { origin: null });
      assert.equal(response.status, 403);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("AR-4.3: a request with a mismatched Origin header is rejected with 403", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const response = await postPreview(baseUrl, filePath, { origin: "http://evil.example" });
      assert.equal(response.status, 403);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("FR-4.2: an upload under an unexpected field name is rejected with 400", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const filePath = await buildWorkbookFile([defaultRow()]);
    try {
      const response = await postPreview(baseUrl, filePath, { fieldName: "wrong-field" });
      assert.equal(response.status, 400);
    } finally {
      cleanupFile(filePath);
    }
  });
});

test("AR-4.5: an upload exceeding the configured size limit is rejected with 413", async () => {
  const filePath = await buildWorkbookFile([defaultRow()]);
  try {
    await withTestServer(
      async ({ baseUrl }) => {
        const response = await postPreview(baseUrl, filePath);
        assert.equal(response.status, 413);
      },
      { maxUploadBytes: 100 },
    );
  } finally {
    cleanupFile(filePath);
  }
});
