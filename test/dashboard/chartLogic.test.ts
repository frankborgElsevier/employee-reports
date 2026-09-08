import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
// AR-2.3: the same file the browser loads — no build step, no DOM (AR-1.3).
import {
  buildTree,
  classifyPositionBand,
  countryBucket,
  managerList,
  positionRegionBreakdown,
  POSITION_BAND_ORDER,
  totals,
  visibleIds,
} from "../../public/chart-logic.js";

interface PayloadEmployee {
  id: string;
  name: string;
  position: string;
  country: string;
  managerId: string | null;
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
    position: "Software Engineer II",
    country: "United Kingdom",
    managerId,
    ...overrides,
  };
}

/** FR-1.3, FR-1.4, FR-2.5: the 3-level chain the reference export cannot produce. */
function chainABC(): PayloadEmployee[] {
  return [employee("a", "Ana", null), employee("b", "Ben", "a"), employee("c", "Cleo", "b")];
}

function allSelected(employees: PayloadEmployee[]): Set<string> {
  return new Set(managerList(employees).map((manager) => manager.id));
}

describe("colour buckets", () => {
  it("FR-1.6: the United Kingdom and the United States are blue, India is red", () => {
    assert.equal(countryBucket("United Kingdom"), "blue");
    assert.equal(countryBucket("United States of America"), "blue");
    assert.equal(countryBucket("India"), "red");
  });

  it("AR-1.2: an unmapped country falls through to green rather than colourless", () => {
    assert.equal(countryBucket("Netherlands"), "green");
    assert.equal(countryBucket("Newly Invented Country"), "green");
  });
});

describe("tree assembly", () => {
  it("FR-1.3: nests to full depth, with one root", () => {
    const { roots, childrenOf } = buildTree(chainABC());
    assert.deepEqual(
      roots.map((root: PayloadEmployee) => root.id),
      ["a"],
    );
    assert.deepEqual(
      childrenOf.get("a").map((child: PayloadEmployee) => child.id),
      ["b"],
    );
    assert.deepEqual(
      childrenOf.get("b").map((child: PayloadEmployee) => child.id),
      ["c"],
    );
  });

  it("FR-1.4: an employee whose manager is absent from the payload is a root", () => {
    // B is inactive, so FR-1.1 leaves them out of the payload entirely.
    const payload = [employee("a", "Ana", null), employee("c", "Cleo", "b")];
    const { roots } = buildTree(payload);
    assert.deepEqual(
      roots.map((root: PayloadEmployee) => root.id),
      ["a", "c"],
    );
    assert.equal(totals(payload).headcount, 2);
  });

  it("FR-1.2: siblings and roots order by name ascending, id ascending as tie-break", () => {
    const payload = [
      employee("2", "Zoe", null),
      employee("1", "Amy", null),
      employee("4", "Amy", null),
      employee("3", "Amy", null),
    ];
    const { roots } = buildTree(payload);
    assert.deepEqual(
      roots.map((root: PayloadEmployee) => root.id),
      ["1", "3", "4", "2"],
    );
  });

  it("AR-1.5: a 5000-deep chain assembles without overflowing the stack", () => {
    const deep = Array.from({ length: 5000 }, (_, index) =>
      employee(String(index), `Employee ${index}`, index === 0 ? null : String(index - 1)),
    );
    const { roots, childrenOf } = buildTree(deep);
    assert.equal(roots.length, 1);
    assert.equal(childrenOf.get("4998")[0].id, "4999");
  });
});

describe("team sizes (spec 005)", () => {
  it("FR-1.1: a 3-level chain — manager, sub-manager, and 3 ICs under the sub-manager — sizes each ancestor correctly", () => {
    const payload = [
      employee("top", "Top Manager", null),
      employee("sub", "Sub Manager", "top"),
      employee("ic1", "Ivy One", "sub"),
      employee("ic2", "Ivy Two", "sub"),
      employee("ic3", "Ivy Three", "sub"),
    ];
    const { teamSizes } = buildTree(payload);
    assert.equal(teamSizes.get("top"), 4);
    assert.equal(teamSizes.get("sub"), 3);
    assert.equal(teamSizes.get("ic1"), 0);
    assert.equal(teamSizes.get("ic2"), 0);
    assert.equal(teamSizes.get("ic3"), 0);
  });

  it("FR-1.2: an employee with zero reports has teamSizes.get(id) === 0", () => {
    const payload = [employee("a", "Ana", null)];
    const { teamSizes } = buildTree(payload);
    assert.equal(teamSizes.get("a"), 0);
  });
});

describe("managers-first ordering (spec 005, AR-3.1)", () => {
  it("FR-3.1: managers sort before non-managers, alphabetical order preserved within each group", () => {
    // Plain byNameThenId would order these Amy, Ben, Cleo, Dan, Zoe — proving
    // this test actually exercises byManagerThenNameThenId rather than the
    // pre-existing comparator requires Zoe (a manager) to jump ahead of the
    // alphabetically-earlier non-managers.
    const payload = [
      employee("boss", "Boss", null),
      employee("amy", "Amy", "boss"),
      employee("ben", "Ben", "boss"),
      employee("cleo", "Cleo", "boss"), // manager: has a report
      employee("dan", "Dan", "boss"),
      employee("zoe", "Zoe", "boss"), // manager: has a report
      employee("report1", "Report One", "cleo"),
      employee("report2", "Report Two", "zoe"),
    ];
    const { childrenOf } = buildTree(payload);
    assert.deepEqual(
      childrenOf.get("boss").map((child: PayloadEmployee) => child.id),
      ["cleo", "zoe", "amy", "ben", "dan"],
    );
  });

  it("FR-3.1: root-level siblings are also ordered managers-first", () => {
    const payload = [
      employee("amy", "Amy", null),
      employee("zoe", "Zoe", null), // manager: has a report
      employee("report", "Report", "zoe"),
    ];
    const { roots } = buildTree(payload);
    assert.deepEqual(
      roots.map((root: PayloadEmployee) => root.id),
      ["zoe", "amy"],
    );
  });
});

describe("manager list", () => {
  it("FR-2.3: one entry per employee with reports, ordered by name", () => {
    const payload = [
      employee("a", "Ana", null),
      employee("b", "Ben", "a"),
      employee("c", "Cleo", "b"),
      employee("d", "Dev", "a"),
    ];
    assert.deepEqual(
      managerList(payload).map((manager: { id: string }) => manager.id),
      ["a", "b"],
    );
  });

  it("FR-2.3: a root with direct reports still gets a checkbox", () => {
    // The reference file's normal case: every manager reports to a supervisor
    // absent from the export, so every manager is also a root.
    const payload = [employee("a", "Ana", "absent-supervisor"), employee("b", "Ben", "a")];
    assert.deepEqual(
      managerList(payload).map((manager: { id: string }) => manager.id),
      ["a"],
    );
  });

  it("FR-2.3: an all-root roster yields no checkboxes at all", () => {
    const payload = [employee("a", "Ana", null), employee("b", "Ben", null)];
    assert.deepEqual(managerList(payload), []);
  });

  it("FR-3.2: managerList() stays in plain alphabetical order regardless of insertion order or manager depth", () => {
    // managerList() filters to managers only, then sorts that subset with
    // byNameThenId directly (it never reads buildTree's roots/childrenOf
    // order) — so on an all-manager set, AR-3.1's manager-first comparator
    // and plain byNameThenId are mathematically indistinguishable (every
    // element in the subset already has reports). What *can* regress is
    // managerList() silently switching to reflect buildTree's internal
    // (now managers-first) ordering, or hierarchy depth, instead of staying
    // alphabetical — this asserts against both by feeding a multi-level
    // hierarchy in non-alphabetical insertion order and requiring pure
    // alphabetical output.
    const payload = [
      employee("zed", "Zed", null), // root manager of a manager
      employee("yara", "Yara", "zed"), // manager of an IC
      employee("wendy", "Wendy", "yara"), // IC, not a manager
      employee("amy", "Amy", null), // root manager of an IC
      employee("vic", "Vic", "amy"), // IC, not a manager
    ];
    assert.deepEqual(
      managerList(payload).map((manager: { id: string }) => manager.id),
      ["amy", "yara", "zed"],
    );
  });

  it("FR-2.3: duplicate names are disambiguated, unique ones are not", () => {
    const payload = [
      employee("1", "Sam", null),
      employee("2", "Sam", null),
      employee("3", "Uma", null),
      employee("x", "Report A", "1"),
      employee("y", "Report B", "2"),
      employee("z", "Report C", "3"),
    ];
    assert.deepEqual(
      managerList(payload).map((manager: { label: string }) => manager.label),
      ["Sam (1)", "Sam (2)", "Uma"],
    );
  });
});

describe("visibility filtering", () => {
  it("FR-2.4: deselecting a manager hides their whole subtree but not their own card", () => {
    const payload = chainABC();
    const visible = visibleIds(payload, new Set(["b"])); // 'a' deselected
    assert.deepEqual([...visible].sort(), ["a"]);
  });

  it("FR-2.4: reselecting restores the subtree", () => {
    const payload = chainABC();
    const visible = visibleIds(payload, allSelected(payload));
    assert.deepEqual([...visible].sort(), ["a", "b", "c"]);
  });

  it("FR-2.5: nested deselection is subtractive", () => {
    const payload = chainABC();
    // Both deselected: only A remains.
    assert.deepEqual([...visibleIds(payload, new Set())].sort(), ["a"]);
    // A reselected, B still deselected: B returns, C stays hidden.
    assert.deepEqual([...visibleIds(payload, new Set(["a"]))].sort(), ["a", "b"]);
  });

  it("FR-2.7: with every checkbox deselected, only roots remain visible", () => {
    const payload = [
      employee("a", "Ana", "absent"),
      employee("b", "Ben", "absent"),
      employee("c", "Cleo", "a"),
    ];
    assert.deepEqual([...visibleIds(payload, new Set())].sort(), ["a", "b"]);
  });

  it("FR-1.4: a root is visible in every checkbox state", () => {
    const payload = chainABC();
    assert.ok(visibleIds(payload, new Set()).has("a"));
    assert.ok(visibleIds(payload, allSelected(payload)).has("a"));
  });
});

describe("visibleIds requireRootSelection option (spec 006 AR-1.1)", () => {
  it("defaults to false: every existing call site (no third argument) is unaffected", () => {
    const payload = chainABC();
    // Identical to the "FR-2.5: nested deselection is subtractive" case
    // above — omitting the options argument entirely must behave exactly
    // as it did before this option existed.
    assert.deepEqual([...visibleIds(payload, new Set())].sort(), ["a"]);
    assert.deepEqual([...visibleIds(payload, new Set(["a"]))].sort(), ["a", "b"]);
  });

  it("false explicitly: a root not in selectedManagerIds is still unconditionally visible", () => {
    const payload = chainABC();
    const visible = visibleIds(payload, new Set(), { requireRootSelection: false });
    assert.ok(visible.has("a"));
  });

  it("true: a root not in selectedManagerIds is hidden, along with its subtree", () => {
    const payload = chainABC();
    const visible = visibleIds(payload, new Set(["b"]), { requireRootSelection: true });
    // "a" (the only root) is not in selectedManagerIds, so nothing is
    // seeded and nothing is visible at all -- not even "a" itself, and not
    // "b" even though "b" is checked (traversal never reaches it).
    assert.deepEqual([...visible], []);
  });

  it("true: a checked root's traversal proceeds exactly as when the option is false", () => {
    const payload = chainABC();
    // "a" checked, "b" unchecked: isolation is irrelevant here since the
    // one root is selected -- B's own row stays visible, C is hidden,
    // matching the option-false/FR-2.4 behavior exactly.
    const visible = visibleIds(payload, new Set(["a"]), { requireRootSelection: true });
    assert.deepEqual([...visible].sort(), ["a", "b"]);
  });

  it("true: with two roots, only the checked root's own row and subtree are visible", () => {
    const payload = [
      employee("m1", "M1", null),
      employee("e1", "E1", "m1"),
      employee("m2", "M2", null),
      employee("e2", "E2", "m2"),
    ];
    const visible = visibleIds(payload, new Set(["m1"]), { requireRootSelection: true });
    assert.deepEqual([...visible].sort(), ["e1", "m1"]);
  });
});

describe("position band classification (spec 006 FR-3.1)", () => {
  it("classifies the reference file's 14 distinct positions exactly as specified", () => {
    const expected: Record<string, string> = {
      "Software Engineer II": "Software Engineer 2",
      "Senior Software Engineer I": "Senior 1",
      "Senior Software Engineer II": "Senior 2",
      "Senior Quality Test Engineer II": "Senior 2",
      "Consult/Prin Quality Test Engr": "Principal",
      "Consulting/Principal Quality Test Engineer": "Principal",
      "Principal Quality Test Engineer": "Principal",
      "Consulting/Principal Software Engineer": "Principal",
      "Principal Software Engineer": "Principal",
      "Software Engineering Lead": "Lead",
      "Sr Principal Software Engineer": "Senior Principal",
      "Software Engineer III": "Other",
      "Quality Test Engineer III": "Other",
      "Sr. Business Analyst": "Other",
    };
    for (const [position, band] of Object.entries(expected)) {
      assert.equal(classifyPositionBand(position), band, `${position} -> expected ${band}`);
    }
  });

  it("no position in the reference file classifies as Software Engineer 1", () => {
    assert.notEqual(classifyPositionBand("Software Engineer II"), "Software Engineer 1");
  });

  it("exact-token matching keeps a level-III title out of the level-2 rule", () => {
    // "iii" is a distinct token from "ii", even though the string "iii"
    // contains the substring "ii" -- this is the case the spec's tokenizer
    // rule exists specifically to get right.
    assert.equal(classifyPositionBand("Software Engineer III"), "Other");
  });

  it("Senior Principal outranks plain Principal and plain Senior", () => {
    assert.equal(classifyPositionBand("Sr Principal Software Engineer"), "Senior Principal");
  });

  it("Lead outranks Principal and Senior when a title combines them", () => {
    assert.equal(classifyPositionBand("Principal Software Engineering Lead"), "Lead");
  });

  it("Senior 1/2 are job-family-agnostic; Software Engineer 1/2 require the software+engineer pair", () => {
    assert.equal(classifyPositionBand("Senior Business Analyst II"), "Senior 2");
    assert.equal(classifyPositionBand("Sr. Business Analyst"), "Other");
  });

  it("a leading or doubled separator produces no empty token that could spuriously match", () => {
    assert.equal(classifyPositionBand("/Software Engineer II"), "Software Engineer 2");
    assert.equal(classifyPositionBand("Software  Engineer  II"), "Software Engineer 2");
  });

  it("POSITION_BAND_ORDER holds exactly the eight fixed band names in display order", () => {
    assert.deepEqual(POSITION_BAND_ORDER, [
      "Software Engineer 1",
      "Software Engineer 2",
      "Senior 1",
      "Senior 2",
      "Principal",
      "Lead",
      "Senior Principal",
      "Other",
    ]);
  });
});

describe("positionRegionBreakdown (spec 006 AR-3.1)", () => {
  it("FR-3.1, FR-3.4: groups the reference-shaped roster into bands, regions, and totals matching the spec's worked example", () => {
    const payload = [
      ...Array.from({ length: 4 }, (_, i) => employee(`se2-${i}`, `SE2 ${i}`, null, { position: "Software Engineer II", country: "United Kingdom" })),
      ...Array.from({ length: 6 }, (_, i) => employee(`s1-${i}`, `S1 ${i}`, null, { position: "Senior Software Engineer I", country: "India" })),
      employee("other-1", "Other One", null, { position: "Software Engineer III", country: "Netherlands" }),
    ];
    const { bands, totals: bucketTotals } = positionRegionBreakdown(payload);

    assert.deepEqual(
      bands.map((b: { band: string }) => b.band),
      ["Software Engineer 2", "Senior 1", "Other"],
    );

    const se2 = bands[0];
    assert.deepEqual(se2.rows, [{ position: "Software Engineer II", blue: 4, red: 0, green: 0, purple: 0, total: 4 }]);

    const senior1 = bands[1];
    assert.deepEqual(senior1.rows, [{ position: "Senior Software Engineer I", blue: 0, red: 6, green: 0, purple: 0, total: 6 }]);

    assert.deepEqual(bucketTotals, { blue: 4, red: 6, green: 1, purple: 0, total: 11 });
  });

  it("FR-3.3: a band with no visible members is omitted entirely, not shown with a zero row", () => {
    const payload = [employee("a", "Ana", null, { position: "Software Engineer II", country: "United Kingdom" })];
    const { bands } = positionRegionBreakdown(payload);
    assert.deepEqual(bands.map((b: { band: string }) => b.band), ["Software Engineer 2"]);
  });

  it("D1: an empty input renders no bands and a zeroed totals row", () => {
    const { bands, totals: bucketTotals } = positionRegionBreakdown([]);
    assert.deepEqual(bands, []);
    assert.deepEqual(bucketTotals, { blue: 0, red: 0, green: 0, purple: 0, total: 0 });
  });

  it("FR-3.2: within a band, positions order by total count descending, then position ascending", () => {
    const payload = [
      employee("a", "Ana", null, { position: "Principal Quality Test Engineer", country: "United Kingdom" }),
      employee("b", "Ben", null, { position: "Consulting/Principal Software Engineer", country: "United Kingdom" }),
      employee("c", "Cleo", null, { position: "Consulting/Principal Software Engineer", country: "India" }),
      employee("d", "Dev", null, { position: "Consulting/Principal Quality Test Engineer", country: "United Kingdom" }),
    ];
    const { bands } = positionRegionBreakdown(payload);
    const principal = bands.find((b: { band: string }) => b.band === "Principal");
    assert.deepEqual(
      principal.rows.map((row: { position: string }) => row.position),
      [
        "Consulting/Principal Software Engineer", // count 2, highest
        "Consulting/Principal Quality Test Engineer", // count 1, alphabetically first among the ties
        "Principal Quality Test Engineer", // count 1
      ],
    );
  });

  it("the grand total always equals the number of employees in the input", () => {
    const payload = [
      employee("a", "Ana", null, { position: "Software Engineer II" }),
      employee("b", "Ben", null, { position: "Senior Software Engineer I" }),
      employee("c", "Cleo", null, { position: "Software Engineer III" }),
    ];
    const { totals: bucketTotals } = positionRegionBreakdown(payload);
    assert.equal(bucketTotals.total, payload.length);
  });

  it("spec 007: contractors count in purple regardless of country", () => {
    const payload = [
      { ...employee("employee", "Ana", null, { position: "Software Engineer II", country: "India" }), isContractor: false },
      { ...employee("contractor", "Sam", "employee", { position: "Software Engineer II", country: "India" }), isContractor: true },
    ];
    const { bands, totals: bucketTotals } = positionRegionBreakdown(payload);
    assert.deepEqual(bands[0].rows, [
      { position: "Software Engineer II", blue: 0, red: 1, green: 0, purple: 1, total: 2 },
    ]);
    assert.deepEqual(bucketTotals, { blue: 0, red: 1, green: 0, purple: 1, total: 2 });
  });
});

describe("totals", () => {
  it("FR-2.2: groups by raw position string, count descending then position ascending", () => {
    const payload = [
      employee("1", "A", null, { position: "Software Engineer II" }),
      employee("2", "B", null, { position: "Software Engineer II" }),
      employee("3", "C", null, { position: "Consult/Prin Quality Test Engr" }),
      employee("4", "D", null, { position: "Consulting/Principal Quality Test Engineer" }),
    ];
    assert.deepEqual(totals(payload).byPosition, [
      { position: "Software Engineer II", count: 2 },
      { position: "Consult/Prin Quality Test Engr", count: 1 },
      { position: "Consulting/Principal Quality Test Engineer", count: 1 },
    ]);
  });

  it("FR-2.6: a position whose count falls to zero disappears from the breakdown", () => {
    const payload = [
      employee("a", "Ana", null, { position: "Manager" }),
      employee("b", "Ben", "a", { position: "Engineer" }),
    ];
    const visible = visibleIds(payload, new Set());
    const visibleEmployees = payload.filter((row) => visible.has(row.id));
    const result = totals(visibleEmployees);
    assert.equal(result.headcount, 1);
    assert.deepEqual(result.byPosition, [{ position: "Manager", count: 1 }]);
  });
});
