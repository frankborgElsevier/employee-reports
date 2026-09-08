import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundError, ValidationError } from "../../src/db/errors.js";
import { deleteRatingRecord, upsertEmployee, upsertRatingRecord } from "../../src/db/mutations.js";
import { getLastRatings, getRatingHistory } from "../../src/db/queries.js";
import { withFreshDatabase } from "./helpers.js";

function seedEmployee(): void {
  upsertEmployee({ id: "emp-1", name: "Bob", position: "Engineer", country: "UK" });
}

test("FR-3.1: two rating rows for the same employee/period is a single upserted row", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertRatingRecord("emp-1", "Most Recent", "Meets Expectations");
    upsertRatingRecord("emp-1", "Most Recent", "Exceeds Expectations");
    const history = getRatingHistory("emp-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].ratingValue, "Exceeds Expectations");
  });
});

test("FR-3.2: fewer than 3 ratings returns however many exist, not padded", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertRatingRecord("emp-1", "Most Recent", "Good");
    upsertRatingRecord("emp-1", "Prior Rating", "Great");
    const last3 = getLastRatings("emp-1", 3);
    assert.equal(last3.length, 2);
  });
});

test("FR-3.2: limit must be a positive integer", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => getLastRatings("emp-1", 0), RangeError);
  });
});

test("FR-3.3: empty rating_value is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertRatingRecord("emp-1", "Most Recent", "   "), ValidationError);
  });
});

test("FR-3.3: rating_value over 200 characters is rejected", () => {
  withFreshDatabase(() => {
    seedEmployee();
    assert.throws(() => upsertRatingRecord("emp-1", "Most Recent", "x".repeat(500)), ValidationError);
  });
});

test("FR-3.3: an unrecognized rating_period is rejected, and case-sensitive", () => {
  withFreshDatabase(() => {
    seedEmployee();
    // @ts-expect-error — deliberately passing an invalid period at runtime
    assert.throws(() => upsertRatingRecord("emp-1", "Last Year", "Good"), ValidationError);
    // @ts-expect-error — deliberately passing wrong-case text at runtime
    assert.throws(() => upsertRatingRecord("emp-1", "most recent", "Good"), ValidationError);
    assert.doesNotThrow(() => upsertRatingRecord("emp-1", "Most Recent", "Good"));
  });
});

test("FR-4.1: getRatingHistory and getLastRatings both return the fixed period order", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertRatingRecord("emp-1", "Two Year Prior Rating", "Good");
    upsertRatingRecord("emp-1", "Most Recent", "Great");
    upsertRatingRecord("emp-1", "Prior Rating", "Fine");
    assert.deepEqual(
      getRatingHistory("emp-1").map((r) => r.ratingPeriod),
      ["Most Recent", "Prior Rating", "Two Year Prior Rating"],
    );
    assert.deepEqual(
      getLastRatings("emp-1", 2).map((r) => r.ratingPeriod),
      ["Most Recent", "Prior Rating"],
    );
  });
});

test("FR-4.3: deleteRatingRecord removes an existing rating", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertRatingRecord("emp-1", "Two Year Prior Rating", "Good");
    deleteRatingRecord("emp-1", "Two Year Prior Rating");
    assert.deepEqual(getRatingHistory("emp-1"), []);
  });
});

test("FR-4.3: deleteRatingRecord on an existing employee's absent period is a no-op", () => {
  withFreshDatabase(() => {
    seedEmployee();
    upsertRatingRecord("emp-1", "Most Recent", "Good");
    assert.doesNotThrow(() => deleteRatingRecord("emp-1", "Two Year Prior Rating"));
    assert.equal(getRatingHistory("emp-1").length, 1);
  });
});

test("FR-4.3: deleteRatingRecord on a non-existent employee throws", () => {
  withFreshDatabase(() => {
    assert.throws(() => deleteRatingRecord("ghost", "Most Recent"), NotFoundError);
  });
});
