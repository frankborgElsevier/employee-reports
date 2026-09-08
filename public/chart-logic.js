/**
 * AR-2.3: the DOM-independent half of the Headcount Dashboard (spec 003).
 * Every function here takes data and returns data — no DOM access — so the
 * tree, visibility, and totals rules can be unit-tested with `node:test`
 * even though this project has no browser test harness. `headcount.html`
 * holds the thin wiring that turns these results into elements.
 *
 * Plain ES-module JavaScript rather than TypeScript because AR-1.3 rules out
 * a build step: the browser loads this file directly, and the tests import
 * the same file the browser runs.
 */

/** AR-1.2: the single country -> colour-bucket mapping. Anything absent falls through to green. */
export const COUNTRY_BUCKETS = {
  "United Kingdom": "blue",
  "United States of America": "blue",
  India: "red",
};

export const DEFAULT_BUCKET = "green";
export const CONTRACTOR_BUCKET = "purple";

/** AR-1.2, FR-1.6: an unrecognised or newly-appearing country renders green rather than colourless. */
export function countryBucket(country) {
  return COUNTRY_BUCKETS[country] ?? DEFAULT_BUCKET;
}

/** FR-1.2: siblings and roots order by name ascending, id ascending as tie-break. */
function byNameThenId(a, b) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * AR-3.1 (spec 005): a comparator factory closing over `childrenOf` so it can
 * tell managers (at least one direct report) from individual contributors.
 * Managers sort first; within each group, `byNameThenId`'s existing order is
 * unchanged. Not exported — only `buildTree` in this module needs it.
 */
function byManagerThenNameThenId(childrenOf) {
  return (a, b) => {
    const aIsManager = childrenOf.get(a.id).length > 0;
    const bIsManager = childrenOf.get(b.id).length > 0;
    if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;
    return byNameThenId(a, b);
  };
}

/**
 * FR-1.3, FR-1.4: assembles the parent/child forest. An employee is a root
 * when `managerId` is null *or* names someone absent from `employees` — the
 * latter happens whenever an import soft-inactivates a mid-level manager, or
 * when spec 002 nulls a supervisor link pointing outside the file.
 *
 * AR-1.5: iterative throughout. A 5000-deep chain builds without recursion.
 *
 * AR-1.1 (spec 005): `teamSizes` is a fourth return field — a `Map<id,
 * number>` of every employee's total (direct + indirect) descendant count,
 * computed with one additional O(n) bottom-up (post-order) pass over
 * `childrenOf`, independent of and in addition to the sorting above. Built
 * with an explicit state-tagged stack (entering/leaving frames) for a true
 * post-order traversal — a "reverse pre-order" shortcut does not produce
 * correct post-order results here and is intentionally avoided.
 */
export function buildTree(employees) {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const childrenOf = new Map(employees.map((employee) => [employee.id, []]));
  const roots = [];

  for (const employee of employees) {
    const parent = employee.managerId === null ? null : byId.get(employee.managerId);
    if (parent === undefined || parent === null) {
      roots.push(employee);
    } else {
      childrenOf.get(parent.id).push(employee);
    }
  }

  roots.sort(byManagerThenNameThenId(childrenOf));
  for (const children of childrenOf.values()) {
    children.sort(byManagerThenNameThenId(childrenOf));
  }

  const postOrder = [];
  const stack = roots.map((employee) => ({ employee, entering: true }));
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.entering) {
      stack.push({ employee: frame.employee, entering: false });
      for (const child of childrenOf.get(frame.employee.id)) {
        stack.push({ employee: child, entering: true });
      }
    } else {
      postOrder.push(frame.employee);
    }
  }

  const teamSizes = new Map();
  for (const employee of postOrder) {
    let size = 0;
    for (const child of childrenOf.get(employee.id)) {
      size += 1 + teamSizes.get(child.id);
    }
    teamSizes.set(employee.id, size);
  }

  return { roots, childrenOf, byId, teamSizes };
}

/** FR-1.4: an employee whose manager is absent from the payload is a root. */
export function isRoot(employee, byId) {
  return employee.managerId === null || !byId.has(employee.managerId);
}

/**
 * FR-2.3: one entry per employee with at least one direct report, ordered by
 * name then id. Duplicate names are disambiguated as `Name (id)` — only the
 * colliding entries, since the ids are long and unreadable.
 */
export function managerList(employees) {
  const { childrenOf } = buildTree(employees);
  const managers = employees
    .filter((employee) => childrenOf.get(employee.id).length > 0)
    .sort(byNameThenId);

  const nameCounts = new Map();
  for (const manager of managers) {
    nameCounts.set(manager.name, (nameCounts.get(manager.name) ?? 0) + 1);
  }

  return managers.map((manager) => ({
    id: manager.id,
    label: nameCounts.get(manager.name) > 1 ? `${manager.name} (${manager.id})` : manager.name,
  }));
}

/**
 * FR-2.4, FR-2.5, AR-2.1: visibility in one top-down pass from the roots —
 * a node is visible when its parent is visible and its parent's checkbox is
 * selected. Walking each employee's ancestor chain independently would be
 * O(n * depth) instead of O(n), and would make FR-2.5's subtractive
 * behaviour something to get right rather than something that follows.
 *
 * `selectedManagerIds` holds the *checked* boxes. A root is always visible
 * (FR-1.4) by default: nobody sits above them to hide them.
 *
 * AR-1.1 (spec 006): `options.requireRootSelection` (default `false`)
 * overrides that root-always-visible default for callers that need it. The
 * Headcount Dashboard never passes it, so its own behaviour is unchanged.
 * When `true` (Employee Details' manager-filter isolation, spec 006
 * FR-1.1), the traversal is seeded only with the roots present in
 * `selectedManagerIds`; every other root is neither seeded nor traversed
 * into, and is therefore not visible at all.
 */
export function visibleIds(employees, selectedManagerIds, options = {}) {
  const requireRootSelection = options.requireRootSelection ?? false;
  const { roots, childrenOf } = buildTree(employees);
  const visible = new Set();
  const queue = requireRootSelection
    ? roots.filter((employee) => selectedManagerIds.has(employee.id))
    : [...roots];

  while (queue.length > 0) {
    const employee = queue.pop();
    visible.add(employee.id);
    if (!selectedManagerIds.has(employee.id)) {
      // Their own card stays visible; their team does not (FR-2.4).
      continue;
    }
    for (const child of childrenOf.get(employee.id)) {
      queue.push(child);
    }
  }

  return visible;
}

/**
 * FR-2.1, FR-2.2, FR-2.6: totals over the visible set only, so the numbers
 * always describe the cards on screen. Positions group on the raw string —
 * the source report contains both `Consult/Prin Quality Test Engr` and
 * `Consulting/Principal Quality Test Engineer`, and this app has no
 * authority to decide they are the same role.
 */
export function totals(visibleEmployees) {
  const counts = new Map();
  for (const employee of visibleEmployees) {
    counts.set(employee.position, (counts.get(employee.position) ?? 0) + 1);
  }

  const byPosition = [...counts.entries()]
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => b.count - a.count || a.position.localeCompare(b.position));

  return { headcount: visibleEmployees.length, byPosition };
}

/**
 * FR-3.1 (spec 006): splits a position string into lowercase tokens on any
 * run of non-alphanumeric characters, dropping any resulting empty piece
 * (from a leading, trailing, or doubled separator). Exact token equality is
 * what `classifyPositionBand` matches on below, not substring search — this
 * is what keeps `"Software Engineer III"` (tokenizing to `[..., "iii"]`) out
 * of the level-2 rule, since `"iii"` is a distinct token from `"ii"`.
 */
function tokenizePosition(position) {
  return position
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

const SENIOR_TOKENS = new Set(["senior", "sr"]);
const PRINCIPAL_TOKENS = new Set(["principal", "prin"]);
const LEVEL_1_TOKENS = new Set(["i", "1"]);
const LEVEL_2_TOKENS = new Set(["ii", "2"]);

function hasAnyToken(tokens, tokenSet) {
  return tokens.some((token) => tokenSet.has(token));
}

/**
 * FR-3.1, FR-3.2 (spec 006): the fixed, literal band names, in the fixed
 * display order the Headcount Dashboard's position-by-region table renders
 * them in. Each name doubles as the classification result below and the
 * rendered header text — no separate label lookup exists.
 */
export const POSITION_BAND_ORDER = [
  "Software Engineer 1",
  "Software Engineer 2",
  "Senior 1",
  "Senior 2",
  "Principal",
  "Lead",
  "Senior Principal",
  "Other",
];

/**
 * FR-3.1 (spec 006): classifies a `position` string into exactly one of
 * `POSITION_BAND_ORDER`'s eight bands, evaluated in this fixed priority
 * order — the first matching rule wins. Rules for Senior Principal/Lead/
 * Principal/Senior 2/Senior 1 are job-family-agnostic (seniority/level
 * tokens alone); Software Engineer 1/2 additionally require the
 * `software`+`engineer` token pair, deliberately narrower than the generic
 * Senior bands (see the spec's FR-3.1 for the rationale). This is a
 * presentation-only classification (AR-3.3) — it never alters the
 * underlying `position` string.
 */
export function classifyPositionBand(position) {
  const tokens = tokenizePosition(position);
  const hasSenior = hasAnyToken(tokens, SENIOR_TOKENS);
  const hasPrincipal = hasAnyToken(tokens, PRINCIPAL_TOKENS);
  const hasLead = tokens.includes("lead");
  const hasLevel1 = hasAnyToken(tokens, LEVEL_1_TOKENS);
  const hasLevel2 = hasAnyToken(tokens, LEVEL_2_TOKENS);
  const hasSoftwareEngineer = tokens.includes("software") && tokens.includes("engineer");

  if (hasSenior && hasPrincipal) return "Senior Principal";
  if (hasLead) return "Lead";
  if (hasPrincipal) return "Principal";
  if (hasSenior && hasLevel2) return "Senior 2";
  if (hasSenior && hasLevel1) return "Senior 1";
  if (hasSoftwareEngineer && hasLevel2) return "Software Engineer 2";
  if (hasSoftwareEngineer && hasLevel1) return "Software Engineer 1";
  return "Other";
}

/**
 * AR-3.1 (spec 006): builds the Headcount Dashboard's position-by-region
 * matrix from the currently-visible employee set. Requires its input to
 * already exclude every `isExternal: true` entry (spec 005 FR-2.4's
 * external-manager placeholder, whose `position` is `null` and would
 * otherwise reach, and throw inside, `classifyPositionBand`) — callers must
 * apply the same `!employee.isExternal` filter already applied before
 * calling `totals()`.
 *
 * Returns `{ bands, totals }`: `bands` is one entry per non-empty band (in
 * `POSITION_BAND_ORDER`'s fixed sequence — an empty band is omitted
 * entirely, FR-3.3), each `{ band, rows }` with `rows` ordered by total
 * count descending then position ascending (spec 003 FR-2.2's existing
 * tie-break, reused unchanged within each band); each row is
 * `{ position, blue, red, green, total }`. `totals` is always present,
 * even when `bands` is `[]`, and sums every row across every band —
 * `{ blue, red, green, total }` — which can never disagree with the number
 * of employees in the input, since it is derived from exactly that set.
 */
export function positionRegionBreakdown(visibleEmployees) {
  const rowsByBand = new Map();

  for (const employee of visibleEmployees) {
    const band = classifyPositionBand(employee.position);
    const bucket = employee.isContractor ? CONTRACTOR_BUCKET : countryBucket(employee.country);

    if (!rowsByBand.has(band)) rowsByBand.set(band, new Map());
    const rowsByPosition = rowsByBand.get(band);
    if (!rowsByPosition.has(employee.position)) {
      rowsByPosition.set(employee.position, {
        position: employee.position,
        blue: 0,
        red: 0,
        green: 0,
        purple: 0,
        total: 0,
      });
    }
    const row = rowsByPosition.get(employee.position);
    row[bucket] += 1;
    row.total += 1;
  }

  const bands = [];
  for (const band of POSITION_BAND_ORDER) {
    const rowsByPosition = rowsByBand.get(band);
    if (!rowsByPosition) continue;
    const rows = [...rowsByPosition.values()].sort(
      (a, b) => b.total - a.total || a.position.localeCompare(b.position),
    );
    bands.push({ band, rows });
  }

  const totals = { blue: 0, red: 0, green: 0, purple: 0, total: 0 };
  for (const employee of visibleEmployees) {
    totals[employee.isContractor ? CONTRACTOR_BUCKET : countryBucket(employee.country)] += 1;
    totals.total += 1;
  }

  return { bands, totals };
}
