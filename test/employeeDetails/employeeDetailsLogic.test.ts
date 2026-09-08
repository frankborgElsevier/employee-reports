import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
// AR-2.3: the same file the browser loads — no build step, no DOM (AR-1.2).
import {
  PERFORMANCE_CATEGORIES,
  RATING_PERIODS,
  canonicalPerformanceCategory,
  distinctPositions,
  isValidPayload,
  matchesPerformanceFilters,
  sortRows,
  visibleRows,
} from "../../public/employeeDetailsLogic.js";
// spec 006 AR-1.1: rootManagerIds is computed the same way employee-details.html's
// start() computes it, reused here rather than duplicated per test.
import { buildTree, isRoot, managerList } from "../../public/chart-logic.js";

interface Ratings {
  mostRecent: string | null;
  priorRating: string | null;
  twoYearPriorRating: string | null;
}

interface PayloadEmployee {
  id: string;
  name: string;
  position: string;
  managerId: string | null;
  currency: string | null;
  baseSalary: number | null;
  bonus: number | null;
  compRatio: number | null;
  ratings: Ratings;
}

function employee(
  id: string,
  name: string,
  managerId: string | null,
  overrides: Partial<PayloadEmployee> = {},
): PayloadEmployee {
  return {
    id,
    name,
    managerId,
    position: "Software Engineer II",
    currency: "USD",
    baseSalary: 50000,
    bonus: 1000,
    compRatio: 1.0,
    ratings: { mostRecent: "Meets Expectations", priorRating: "Meets Expectations", twoYearPriorRating: "Meets Expectations" },
    ...overrides,
  };
}

/** FR-2.3: the 3-level chain the reference export cannot produce, reused from spec 003's tests. */
function chainABC(): PayloadEmployee[] {
  return [employee("a", "Ana", null), employee("b", "Ben", "a"), employee("c", "Cleo", "b")];
}

/**
 * spec 006 FR-1.2: the two-root fixture the spec's own Verify uses — A has
 * child manager B, who has child C (a three-level chain); X separately has
 * one direct report, Y (an individual contributor with no relation to
 * A/B/C). Manager checkboxes are {A, B, X}; root managers are {A, X}.
 */
function fixtureABCXY(): PayloadEmployee[] {
  return [
    employee("a", "Ana", null),
    employee("b", "Ben", "a"),
    employee("c", "Cleo", "b"),
    employee("x", "Xan", null),
    employee("y", "Yara", "x"),
  ];
}

function allPositions(employees: PayloadEmployee[]): Set<string> {
  return new Set(distinctPositions(employees));
}

function allManagerIds(employees: PayloadEmployee[]): Set<string> {
  // Every employee in these fixtures who has at least one report.
  const managerIds = new Set(employees.map((e) => e.managerId).filter((id): id is string => id !== null));
  return managerIds;
}

function allPerformanceCategories(): Set<string> {
  return new Set(PERFORMANCE_CATEGORIES);
}

function allRatingPeriodKeys(): Set<string> {
  return new Set(RATING_PERIODS.map(({ key }) => key));
}

/**
 * spec 006 AR-1.1: the `Set<string>` of every root manager's id — computed
 * exactly the way `employee-details.html`'s `start()` computes it once per
 * page load, reused here so every test in this file exercises the same
 * root-manager identification the browser actually runs.
 */
function rootManagerIdsOf(employees: PayloadEmployee[]): Set<string> {
  const { byId } = buildTree(employees as never);
  const managers = managerList(employees as never);
  return new Set(
    managers.filter((manager: { id: string }) => isRoot(byId.get(manager.id), byId)).map((manager: { id: string }) => manager.id),
  );
}

describe("distinctPositions", () => {
  it("FR-2.1: one entry per distinct position, sorted alphabetically ascending", () => {
    const employees = [
      employee("1", "A", null, { position: "Software Engineer II" }),
      employee("2", "B", null, { position: "Consult/Prin Quality Test Engr" }),
      employee("3", "C", null, { position: "Consulting/Principal Quality Test Engineer" }),
      employee("4", "D", null, { position: "Software Engineer II" }),
    ];
    assert.deepEqual(distinctPositions(employees), [
      "Consult/Prin Quality Test Engr",
      "Consulting/Principal Quality Test Engineer",
      "Software Engineer II",
    ]);
  });
});

describe("visibleRows", () => {
  it("spec 006 FR-1.1: with every root manager checked, visibility matches today's (spec 004) behavior", () => {
    const employees = chainABC();
    const positions = allPositions(employees);
    const rootManagerIds = rootManagerIdsOf(employees); // {"a"}

    // A (the only root manager) checked, B unchecked: C hidden, B's own row stays visible.
    const withBUnchecked = visibleRows(employees, positions, new Set(["a"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(withBUnchecked.map((e) => e.id).sort(), ["a", "b"]);
  });

  it("spec 006 FR-1.1: supersedes spec 004 FR-2.3/FR-2.5 — unchecking the only root manager now hides everyone, not just their subtree", () => {
    const employees = chainABC();
    const positions = allPositions(employees);
    const rootManagerIds = rootManagerIdsOf(employees); // {"a"}

    // A (the only root manager) unchecked, B checked: isolation triggers.
    // Seeded only from checked root managers — none — so nothing is visible
    // at all, including A's own row. This is the exact case spec 006 FR-1.1
    // states supersedes spec 004 FR-2.5's "manager filter alone can never
    // reach zero rows" claim.
    const withAUnchecked = visibleRows(employees, positions, new Set(["b"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(withAUnchecked, []);
  });

  it("spec 006 FR-1.1: unchecking one of two root managers hides their team and every unrelated root, not just their team", () => {
    // Two root managers, m1 (2 reports) and m2 (2 reports), plus two
    // individual-contributor roots (i1, i2) whose manager reference never
    // resolves — a smaller analog of the reference file's 5-manager,
    // 6-unrelated-IC shape.
    const employees = [
      employee("m1", "M1", null),
      employee("e1", "E1", "m1"),
      employee("e2", "E2", "m1"),
      employee("m2", "M2", null),
      employee("e3", "E3", "m2"),
      employee("e4", "E4", "m2"),
      employee("i1", "I1", "phantom"),
      employee("i2", "I2", "phantom"),
    ];
    const positions = allPositions(employees);
    const rootManagerIds = rootManagerIdsOf(employees); // {"m1", "m2"}

    // Default: both root managers checked — matches today's full-visibility behavior.
    const withBothChecked = visibleRows(employees, positions, new Set(["m1", "m2"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(withBothChecked.map((e) => e.id).sort(), ["e1", "e2", "e3", "e4", "i1", "i2", "m1", "m2"]);

    // Uncheck m2 only: isolation triggers. m2's own row and their team (e3,
    // e4) are hidden, and so are the two unrelated IC roots (i1, i2) — they
    // have no checkbox of their own and are no longer unconditionally visible.
    const withM2Unchecked = visibleRows(employees, positions, new Set(["m1"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(withM2Unchecked.map((e) => e.id).sort(), ["e1", "e2", "m1"]);
  });

  it("spec 006 FR-1.2: non-root visibility is unaffected by isolation mode", () => {
    const employees = fixtureABCXY();
    const positions = allPositions(employees);
    const rootManagerIds = rootManagerIdsOf(employees); // {"a", "x"}

    // A and X (both root managers) checked, B unchecked: isolation is off.
    // B's own row stays visible while C (B's only report) is hidden; X and Y
    // are unaffected.
    const isolationOff = visibleRows(employees, positions, new Set(["a", "x"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(isolationOff.map((e) => e.id).sort(), ["a", "b", "x", "y"]);

    // Now additionally uncheck X: isolation turns on (not every root manager
    // is checked). Traversal seeds only from A. X is skipped entirely,
    // hiding X's own row and X's subtree (Y) — even though X was never
    // "reached" by anything. Within A's traversal, nothing changes from the
    // isolation-off case above: A visible, B reached and stays visible
    // (their own row is unaffected by their own checkbox once reached), and
    // B's own checkbox being unchecked still hides only C.
    const isolationOn = visibleRows(employees, positions, new Set(["a"]), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(isolationOn.map((e) => e.id).sort(), ["a", "b"]);
  });

  it("FR-2.4: position and manager filters combine as AND", () => {
    const employees = [
      employee("a", "Ana", null, { position: "Manager" }),
      employee("b", "Ben", "a", { position: "Engineer" }),
      employee("c", "Cleo", "a", { position: "Manager" }),
    ];
    const allManagers = allManagerIds(employees);
    const rootManagerIds = rootManagerIdsOf(employees); // {"a"}

    // Exclude "Engineer" position: b is hidden by position alone. "a" (the
    // only root manager) is checked, so isolation is off.
    const positionOnly = visibleRows(employees, new Set(["Manager"]), allManagers, rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(positionOnly.map((e) => e.id).sort(), ["a", "c"]);

    // Also unchecking manager "a": isolation now triggers (spec 006 FR-1.1),
    // hiding everyone including a's own row — superseding the old
    // root-always-visible behavior this same call exercised under spec 004.
    const both = visibleRows(employees, new Set(["Manager"]), new Set(), rootManagerIds, allPerformanceCategories(), allRatingPeriodKeys());
    assert.deepEqual(both, []);
  });
});

describe("performance filters", () => {
  it("AR-2.1: maps canonical and legacy WorkDay values through the closed category vocabulary", () => {
    assert.equal(canonicalPerformanceCategory("Outstanding Performance"), "Outstanding Performance");
    assert.equal(canonicalPerformanceCategory("Very Strong Performance"), "Very Strong Performance");
    assert.equal(canonicalPerformanceCategory("Exceeds"), "Very Strong Performance");
    assert.equal(canonicalPerformanceCategory("Exceeds Expectations"), "Very Strong Performance");
    assert.equal(canonicalPerformanceCategory("Successful Performance"), "Successful Performance");
    assert.equal(canonicalPerformanceCategory("Meets"), "Successful Performance");
    assert.equal(canonicalPerformanceCategory("Meets Expectations"), "Successful Performance");
    assert.equal(canonicalPerformanceCategory("Performance Requires Improvement"), "Performance Requires Improvement");
    assert.equal(canonicalPerformanceCategory("Exceptional"), null);
  });

  it("FR-2.2: ratings and recencies use OR within a checklist and AND across populated selected periods", () => {
    const outstanding = employee("outstanding", "Outstanding", null, {
      ratings: { mostRecent: "Outstanding Performance", priorRating: "Successful Performance", twoYearPriorRating: null },
    });
    const veryStrong = employee("very-strong", "Very Strong", null, {
      ratings: { mostRecent: "Exceeds Expectations", priorRating: "Meets", twoYearPriorRating: null },
    });
    const selectedRatings = new Set(["Outstanding Performance", "Very Strong Performance"]);

    assert.equal(matchesPerformanceFilters(outstanding, selectedRatings, new Set(["mostRecent"])), true);
    assert.equal(matchesPerformanceFilters(veryStrong, selectedRatings, new Set(["mostRecent"])), true);
    assert.equal(matchesPerformanceFilters(outstanding, selectedRatings, new Set(["mostRecent", "priorRating"])), false);
  });

  it("FR-2.2: a matching most-recent rating with missing historic ratings includes a recent joiner", () => {
    const recentJoiner = employee("recent", "Recent", null, {
      ratings: { mostRecent: "Outstanding Performance", priorRating: null, twoYearPriorRating: null },
    });
    assert.equal(
      matchesPerformanceFilters(recentJoiner, new Set(["Outstanding Performance"]), allRatingPeriodKeys()),
      true,
    );
  });

  it("FR-2.2: any populated selected historic mismatch excludes, while all-null selected periods cannot match", () => {
    const historicMismatch = employee("mismatch", "Mismatch", null, {
      ratings: { mostRecent: "Outstanding Performance", priorRating: "Successful Performance", twoYearPriorRating: null },
    });
    const noRatings = employee("none", "None", null, {
      ratings: { mostRecent: null, priorRating: null, twoYearPriorRating: null },
    });
    const selectedRatings = new Set(["Outstanding Performance"]);

    assert.equal(matchesPerformanceFilters(historicMismatch, selectedRatings, allRatingPeriodKeys()), false);
    assert.equal(matchesPerformanceFilters(noRatings, selectedRatings, allRatingPeriodKeys()), false);
  });

  it("FR-2.2: an unknown populated source value excludes instead of matching a category", () => {
    const unknown = employee("unknown", "Unknown", null, {
      ratings: { mostRecent: "Exceptional", priorRating: null, twoYearPriorRating: null },
    });
    assert.equal(
      matchesPerformanceFilters(unknown, new Set(["Outstanding Performance"]), new Set(["mostRecent"])),
      false,
    );
  });

  it("FR-2.3: an empty selected-rating set excludes, while an empty recency set disables performance filtering", () => {
    const employeeWithAnyRating = employee("any", "Any", null, {
      ratings: { mostRecent: "Successful Performance", priorRating: null, twoYearPriorRating: null },
    });
    assert.equal(matchesPerformanceFilters(employeeWithAnyRating, new Set(), new Set(["mostRecent"])), false);
    assert.equal(matchesPerformanceFilters(employeeWithAnyRating, new Set(), new Set()), true);
  });

  it("AR-2.1/FR-2.2: visibleRows filters on canonical categories while retaining raw rating values in its rows", () => {
    const employees = [
      employee("legacy", "Legacy", null, {
        ratings: { mostRecent: "Meets Expectations", priorRating: null, twoYearPriorRating: null },
      }),
      employee("other", "Other", null, {
        ratings: { mostRecent: "Outstanding Performance", priorRating: null, twoYearPriorRating: null },
      }),
    ];
    const rows = visibleRows(
      employees,
      allPositions(employees),
      allManagerIds(employees),
      rootManagerIdsOf(employees),
      new Set(["Successful Performance"]),
      new Set(["mostRecent"]),
    );
    assert.deepEqual(rows.map((row) => row.id), ["legacy"]);
    assert.equal(rows[0].ratings.mostRecent, "Meets Expectations");
  });
});

describe("sortRows", () => {
  it("FR-3.1: default load order is name ascending, id ascending as tie-break", () => {
    const employees = [
      employee("2", "Zoe", null),
      employee("1", "Amy", null),
      employee("4", "Amy", null),
      employee("3", "Amy", null),
    ];
    const sorted = sortRows(employees, "name", "ascending");
    assert.deepEqual(sorted.map((e) => e.id), ["1", "3", "4", "2"]);
  });

  it("FR-3.2: id sorts lexicographically, not numerically", () => {
    const employees = [employee("9", "A", null), employee("10", "B", null)];
    const ascending = sortRows(employees, "id", "ascending");
    assert.deepEqual(ascending.map((e) => e.id), ["10", "9"]);
  });

  it("FR-3.2: baseSalary and bonus sort numerically", () => {
    const employees = [
      employee("a", "A", null, { baseSalary: 90000 }),
      employee("b", "B", null, { baseSalary: 50000 }),
      employee("c", "C", null, { baseSalary: 70000 }),
    ];
    const ascending = sortRows(employees, "baseSalary", "ascending");
    assert.deepEqual(ascending.map((e) => e.id), ["b", "c", "a"]);
    const descending = sortRows(employees, "baseSalary", "descending");
    assert.deepEqual(descending.map((e) => e.id), ["a", "c", "b"]);
  });

  it("spec 006 FR-2.5: compRatio sorts numerically, missing values last in either direction", () => {
    const employees = [
      employee("a", "A", null, { compRatio: 1.2 }),
      employee("b", "B", null, { compRatio: null }),
      employee("c", "C", null, { compRatio: 0.9 }),
    ];
    const ascending = sortRows(employees, "compRatio", "ascending");
    assert.deepEqual(ascending.map((e) => e.id), ["c", "a", "b"]);
    const descending = sortRows(employees, "compRatio", "descending");
    assert.deepEqual(descending.map((e) => e.id), ["a", "c", "b"]);
  });

  it("FR-3.3: missing bonus values sort last in either direction", () => {
    const employees = [
      employee("a", "A", null, { bonus: 500 }),
      employee("b", "B", null, { bonus: null }),
      employee("c", "C", null, { bonus: 1000 }),
    ];
    const ascending = sortRows(employees, "bonus", "ascending");
    assert.deepEqual(ascending.map((e) => e.id), ["a", "c", "b"]);
    const descending = sortRows(employees, "bonus", "descending");
    assert.deepEqual(descending.map((e) => e.id), ["c", "a", "b"]);
  });

  it("FR-3.3: missing rating values sort last, confirming a string column follows the same rule", () => {
    const employees = [
      employee("a", "A", null, { ratings: { mostRecent: "Exceeds", priorRating: null, twoYearPriorRating: null } }),
      employee("b", "B", null, { ratings: { mostRecent: null, priorRating: null, twoYearPriorRating: null } }),
      employee("c", "C", null, { ratings: { mostRecent: "Meets", priorRating: null, twoYearPriorRating: null } }),
    ];
    const ascending = sortRows(employees, "mostRecent", "ascending");
    assert.deepEqual(ascending.map((e) => e.id), ["a", "c", "b"]);
    const descending = sortRows(employees, "mostRecent", "descending");
    assert.deepEqual(descending.map((e) => e.id), ["c", "a", "b"]);
  });

  it("AR-3.1: ties on a user-initiated sort break by name then id, not payload order", () => {
    const employees = [
      employee("2", "Zoe", null, { baseSalary: 60000 }),
      employee("1", "Amy", null, { baseSalary: 60000 }),
      employee("z", "Amy", null, { baseSalary: 60000 }),
    ];
    const sorted = sortRows(employees, "baseSalary", "ascending");
    // All tied on baseSalary: resolved by name ("Amy" before "Zoe"), then id ("1" before "z").
    assert.deepEqual(sorted.map((e) => e.id), ["1", "z", "2"]);
  });
});

describe("isValidPayload", () => {
  function validEntry(overrides: Record<string, unknown> = {}) {
    return {
      id: "1",
      name: "A",
      position: "X",
      workerType: "employee",
      managerId: null,
      currency: "USD",
      baseSalary: 1,
      bonus: 0,
      compRatio: 1.1,
      ratings: { mostRecent: null, priorRating: null, twoYearPriorRating: null },
      ...overrides,
    };
  }

  it("FR-4.4: a body missing the ratings key entirely is invalid", () => {
    const { ratings: _omitted, ...withoutRatings } = validEntry();
    assert.equal(isValidPayload({ employees: [withoutRatings] }), false);
  });

  it("FR-4.4: a body missing a ratings sub-key is invalid", () => {
    const entry = validEntry({ ratings: { mostRecent: null, priorRating: null } });
    assert.equal(isValidPayload({ employees: [entry] }), false);
  });

  it("FR-4.4: a body missing any other required top-level key is invalid", () => {
    const { managerId: _omitted, ...withoutManagerId } = validEntry();
    assert.equal(isValidPayload({ employees: [withoutManagerId] }), false);
  });

  it("spec 006 FR-2.5: a body missing the compRatio key is invalid", () => {
    const { compRatio: _omitted, ...withoutCompRatio } = validEntry();
    assert.equal(isValidPayload({ employees: [withoutCompRatio] }), false);
  });

  it("spec 006 FR-2.5: a non-null, non-number compRatio is invalid", () => {
    const entry = validEntry({ compRatio: "1.1" });
    assert.equal(isValidPayload({ employees: [entry] }), false);
  });

  it("valid payloads, including all-null salary and partial-but-present ratings, pass", () => {
    assert.equal(isValidPayload({ employees: [] }), true);
    assert.equal(
      isValidPayload({
        employees: [validEntry({ currency: null, baseSalary: null, bonus: null })],
      }),
      true,
    );
    assert.equal(
      isValidPayload({
        employees: [validEntry({ ratings: { mostRecent: "Meets", priorRating: null, twoYearPriorRating: null } })],
      }),
      true,
    );
  });

  it("spec 006 FR-2.2: a valid payload with a null compRatio alongside a populated salary passes", () => {
    assert.equal(isValidPayload({ employees: [validEntry({ compRatio: null })] }), true);
  });

  it("spec 007: a contractor with unavailable WorkDay fields is valid", () => {
    assert.equal(
      isValidPayload({
        employees: [
          validEntry({
            id: "contractor:123",
            workerType: "contractor",
            currency: null,
            baseSalary: null,
            bonus: null,
            compRatio: null,
            ratings: { mostRecent: null, priorRating: null, twoYearPriorRating: null },
          }),
        ],
      }),
      true,
    );
  });

  it("a non-object body, or an employees value that isn't an array, is invalid", () => {
    assert.equal(isValidPayload(null), false);
    assert.equal(isValidPayload({ employees: "not an array" }), false);
    assert.equal(isValidPayload({}), false);
  });
});
