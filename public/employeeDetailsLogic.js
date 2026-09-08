/**
 * AR-2.3: the DOM-independent half of the Employee Details screen (spec 004).
 * Every function here takes data and returns data — no DOM access — so the
 * filtering, sorting, and payload-validation rules can be unit-tested with
 * `node:test` even though this project has no browser test harness.
 * `employee-details.html` holds the thin wiring that turns these results
 * into elements.
 *
 * Plain ES-module JavaScript rather than TypeScript because AR-1.2 rules out
 * a build step: the browser loads this file directly, and the tests import
 * the same file the browser runs.
 */

import { visibleIds } from "./chart-logic.js";

/** AR-2.1: fixed UI/filter vocabulary, deliberately separate from raw WorkDay text. */
export const PERFORMANCE_CATEGORIES = [
  "Outstanding Performance",
  "Very Strong Performance",
  "Successful Performance",
  "Performance Requires Improvement",
];

/** AR-2.1: the rating-object keys and labels shared by the UI and pure matcher. */
export const RATING_PERIODS = [
  { key: "mostRecent", label: "Most Recent" },
  { key: "priorRating", label: "Prior Rating" },
  { key: "twoYearPriorRating", label: "Two Year Prior Rating" },
];

const PERFORMANCE_CATEGORY_BY_SOURCE_VALUE = new Map([
  ["Outstanding Performance", "Outstanding Performance"],
  ["Very Strong Performance", "Very Strong Performance"],
  ["Exceeds", "Very Strong Performance"],
  ["Exceeds Expectations", "Very Strong Performance"],
  ["Successful Performance", "Successful Performance"],
  ["Meets", "Successful Performance"],
  ["Meets Expectations", "Successful Performance"],
  ["Performance Requires Improvement", "Performance Requires Improvement"],
]);

/** AR-2.1: closed mapping; unrecognised values are not silently classified. */
export function canonicalPerformanceCategory(value) {
  return PERFORMANCE_CATEGORY_BY_SOURCE_VALUE.get(value) ?? null;
}

/**
 * FR-2.2/FR-2.3: selected values are alternatives within each checklist,
 * while each populated selected period must match a selected category. Historic
 * nulls are allowed, but at least one populated selected period must match.
 */
export function matchesPerformanceFilters(employee, selectedRatings, selectedRatingKeys) {
  if (selectedRatingKeys.size === 0) return true;
  if (selectedRatings.size === 0) return false;

  let hasMatchingRating = false;
  for (const ratingKey of selectedRatingKeys) {
    const rating = employee.ratings[ratingKey];
    if (rating === null) continue;
    const category = canonicalPerformanceCategory(rating);
    if (category === null || !selectedRatings.has(category)) return false;
    hasMatchingRating = true;
  }
  return hasMatchingRating;
}

/** AR-3.1: the shared tie-break for every sort, initial or user-initiated. */
function byNameThenId(a, b) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** FR-2.1: one entry per distinct `position`, sorted alphabetically ascending via `localeCompare` (AR-3.1). */
export function distinctPositions(employees) {
  return [...new Set(employees.map((employee) => employee.position))].sort((a, b) => a.localeCompare(b));
}

/**
 * AR-2.2: the position filter has no hierarchy — a plain set-membership
 * check, standalone rather than folded into `visibleRows` or copied from
 * `chart-logic.js`.
 */
function matchesPosition(employee, selectedPositions) {
  return selectedPositions.has(employee.position);
}

/**
 * FR-2.4 (spec 004), FR-1.1 (spec 006): a row is visible only when it
 * passes both filters at once -- its `position` is checked, and it is
 * within the manager filter's visible set. The manager filter itself is
 * `visibleIds()` (spec 004 AR-2.1), reused unchanged from `chart-logic.js`
 * rather than reimplemented.
 *
 * `rootManagerIds` (spec 006 AR-1.1) is the `Set<string>` of every root
 * manager's id -- precomputed once by `employee-details.html`'s `start()`
 * and threaded through here on every refresh, rather than recomputed on
 * every call. Isolation mode (spec 006 FR-1.1) activates whenever at least
 * one root manager is currently unchecked.
 */
export function visibleRows(
  employees,
  selectedPositions,
  selectedManagerIds,
  rootManagerIds,
  selectedRatings,
  selectedRatingKeys,
) {
  const requireRootSelection = ![...rootManagerIds].every((id) => selectedManagerIds.has(id));
  const managerVisible = visibleIds(employees, selectedManagerIds, { requireRootSelection });
  return employees.filter(
    (employee) =>
      matchesPosition(employee, selectedPositions) &&
      managerVisible.has(employee.id) &&
      matchesPerformanceFilters(employee, selectedRatings, selectedRatingKeys),
  );
}

const NUMERIC_COLUMNS = new Set(["baseSalary", "bonus", "compRatio"]);

/** FR-3.2: how each sortable column's value is read off an employee row. */
const COLUMN_VALUE = {
  id: (employee) => employee.id,
  name: (employee) => employee.name,
  workerType: (employee) => employee.workerType,
  position: (employee) => employee.position,
  currency: (employee) => employee.currency,
  baseSalary: (employee) => employee.baseSalary,
  bonus: (employee) => employee.bonus,
  compRatio: (employee) => employee.compRatio,
  mostRecent: (employee) => employee.ratings.mostRecent,
  priorRating: (employee) => employee.ratings.priorRating,
  twoYearPriorRating: (employee) => employee.ratings.twoYearPriorRating,
};

/**
 * FR-3.1–FR-3.3, AR-3.1: sorts `rows` by `column` in `direction`
 * (`"ascending"` or `"descending"`). String columns compare via
 * `localeCompare`; `baseSalary`/`bonus` compare numerically. A row whose
 * value in `column` is the FR-1.3 `null` placeholder sorts after every row
 * with a present value, in either direction (FR-3.3) — this check runs
 * before the direction sign is applied, so missing values never move to the
 * top on a descending sort. Every comparison — including ties on a present
 * value — breaks by `name` ascending then `id` ascending (AR-3.1), fixed
 * regardless of the requested direction.
 */
export function sortRows(rows, column, direction) {
  const getValue = COLUMN_VALUE[column];
  const sign = direction === "descending" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aValue = getValue(a);
    const bValue = getValue(b);
    const aMissing = aValue === null;
    const bMissing = bValue === null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing) {
      const comparison = NUMERIC_COLUMNS.has(column) ? aValue - bValue : aValue.localeCompare(bValue);
      if (comparison !== 0) return sign * comparison;
    }
    return byNameThenId(a, b);
  });
}

const RATING_KEYS = RATING_PERIODS.map(({ key }) => key);
const REQUIRED_EMPLOYEE_KEYS = ["id", "name", "position", "workerType", "managerId", "currency", "baseSalary", "bonus", "compRatio", "ratings"];

function isStringOrNull(value) {
  return value === null || typeof value === "string";
}

function isNumberOrNull(value) {
  return value === null || typeof value === "number";
}

function isValidRatings(ratings) {
  if (typeof ratings !== "object" || ratings === null) return false;
  return RATING_KEYS.every((key) => key in ratings && isStringOrNull(ratings[key]));
}

function isValidEmployeeEntry(entry) {
  if (typeof entry !== "object" || entry === null) return false;
  if (!REQUIRED_EMPLOYEE_KEYS.every((key) => key in entry)) return false;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.position === "string" &&
    (entry.workerType === "employee" || entry.workerType === "contractor") &&
    isStringOrNull(entry.managerId) &&
    isStringOrNull(entry.currency) &&
    isNumberOrNull(entry.baseSalary) &&
    isNumberOrNull(entry.bonus) &&
    isNumberOrNull(entry.compRatio) &&
    isValidRatings(entry.ratings)
  );
}

/**
 * FR-4.4, AR-2.3: the automatable half of the malformed-payload rule — a
 * `GET /api/employee-details` body missing `ratings` or a `ratings`
 * sub-key (or any other required key) is invalid, and the page treats an
 * invalid body identically to a network/parse error.
 */
export function isValidPayload(body) {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray(body.employees) &&
    body.employees.every(isValidEmployeeEntry)
  );
}
