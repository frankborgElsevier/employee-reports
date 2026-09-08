import { getConnection } from "./connection.js";
import type { ContractorManagerOption, Employee, ExternalManager, QueryOptions, RatingRecord, SalaryRecord } from "./types.js";

interface EmployeeRow {
  id: string;
  name: string;
  position: string;
  country: string;
  worker_type: Employee["workerType"];
  end_date: string | null;
  manager_id: string | null;
  external_manager_id: string | null;
}

interface ExternalManagerRow {
  id: string;
  name: string;
}

interface SalaryRow {
  employee_id: string;
  effective_year: number;
  currency: string;
  base_salary: number;
  bonus: number;
  comp_ratio: number | null;
}

interface RatingRow {
  employee_id: string;
  rating_period: string;
  rating_value: string;
}

/** FR-3.2: the fixed display order for rating periods (no longer a sortable year). */
const RATING_PERIOD_ORDER_SQL = `CASE rating_period
  WHEN 'Most Recent' THEN 0
  WHEN 'Prior Rating' THEN 1
  WHEN 'Two Year Prior Rating' THEN 2
END`;

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    country: row.country,
    workerType: row.worker_type,
    endDate: row.end_date,
    managerId: row.manager_id,
    externalManagerId: row.external_manager_id,
  };
}

/** FR-2.1 (spec 010): active contractors for the management projection, ordered by name then generated id. */
export function getActiveContractors(): Employee[] {
  const rows = getConnection()
    .prepare<[], EmployeeRow>("SELECT * FROM employees WHERE worker_type = 'contractor' AND end_date IS NULL ORDER BY name ASC, id ASC")
    .all();
  return rows.map(toEmployee);
}

function toExternalManager(row: ExternalManagerRow): ExternalManager {
  return {
    id: row.id,
    name: row.name,
  };
}

function toSalaryRecord(row: SalaryRow): SalaryRecord {
  return {
    employeeId: row.employee_id,
    effectiveYear: row.effective_year,
    currency: row.currency,
    baseSalary: row.base_salary,
    bonus: row.bonus,
    compRatio: row.comp_ratio,
  };
}

function toRatingRecord(row: RatingRow): RatingRecord {
  return {
    employeeId: row.employee_id,
    ratingPeriod: row.rating_period as RatingRecord["ratingPeriod"],
    ratingValue: row.rating_value,
  };
}

/** FR-4.1: returns null when no employee matches (AR-4.4). */
export function getEmployeeById(id: string): Employee | null {
  const row = getConnection()
    .prepare<[string], EmployeeRow>("SELECT * FROM employees WHERE id = ?")
    .get(id);
  return row ? toEmployee(row) : null;
}

/** FR-1.2, FR-4.1: active-only by default, ordered by id ascending (lexicographic). */
export function getAllEmployees(options: QueryOptions = {}): Employee[] {
  const includeInactive = options.includeInactive ?? false;
  const workerType = options.workerType ?? "employee";
  const clauses: string[] = [];
  const values: string[] = [];
  if (!includeInactive) clauses.push("end_date IS NULL");
  if (workerType !== "all") {
    clauses.push("worker_type = ?");
    values.push(workerType);
  }
  const sql = `SELECT * FROM employees${clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id ASC`;
  const rows = getConnection().prepare<string[], EmployeeRow>(sql).all(...values);
  return rows.map(toEmployee);
}

/**
 * FR-1.5: direct and indirect reports of `managerId`, excluding the manager
 * themselves, ordered by depth ascending then id ascending. `includeInactive`
 * filters returned rows only — traversal always walks the full graph.
 */
export function getDescendants(
  managerId: string,
  options: { includeInactive?: boolean } = {},
): Employee[] {
  const includeInactive = options.includeInactive ?? false;
  const sql = `
    WITH RECURSIVE descendants(id, depth) AS (
      SELECT id, 1 FROM employees WHERE manager_id = ?
      UNION ALL
      SELECT e.id, d.depth + 1
      FROM employees e
      JOIN descendants d ON e.manager_id = d.id
    )
    SELECT e.*
    FROM descendants d
    JOIN employees e ON e.id = d.id
    ${includeInactive ? "" : "WHERE e.end_date IS NULL"}
    ORDER BY d.depth ASC, e.id ASC
  `;
  const rows = getConnection().prepare<[string], EmployeeRow>(sql).all(managerId);
  return rows.map(toEmployee);
}

/**
 * FR-1.5: chain of managers above `employeeId`, excluding the employee
 * themselves, ordered from nearest manager to most senior.
 */
export function getAncestors(
  employeeId: string,
  options: { includeInactive?: boolean } = {},
): Employee[] {
  const includeInactive = options.includeInactive ?? false;
  const sql = `
    WITH RECURSIVE ancestors(id, manager_id, depth) AS (
      SELECT id, manager_id, 0 FROM employees WHERE id = ?
      UNION ALL
      SELECT e.id, e.manager_id, a.depth + 1
      FROM employees e
      JOIN ancestors a ON e.id = a.manager_id
    )
    SELECT e.*
    FROM ancestors a
    JOIN employees e ON e.id = a.id
    WHERE a.depth > 0
    ${includeInactive ? "" : "AND e.end_date IS NULL"}
    ORDER BY a.depth ASC
  `;
  const rows = getConnection().prepare<[string], EmployeeRow>(sql).all(employeeId);
  return rows.map(toEmployee);
}

/**
 * FR-2.2: the salary_history row with the highest effective_year not
 * greater than the current calendar year. Returns null both when the
 * employee has no eligible row and when the employee doesn't exist (AR-4.4).
 */
export function getCurrentSalary(employeeId: string): SalaryRecord | null {
  const currentYear = new Date().getUTCFullYear();
  const row = getConnection()
    .prepare<
      [string, number],
      SalaryRow
    >("SELECT * FROM salary_history WHERE employee_id = ? AND effective_year <= ? ORDER BY effective_year DESC LIMIT 1")
    .get(employeeId, currentYear);
  return row ? toSalaryRecord(row) : null;
}

/** FR-4.1: complete salary history, ordered chronologically. */
export function getSalaryHistory(employeeId: string): SalaryRecord[] {
  const rows = getConnection()
    .prepare<
      [string],
      SalaryRow
    >("SELECT * FROM salary_history WHERE employee_id = ? ORDER BY effective_year ASC")
    .all(employeeId);
  return rows.map(toSalaryRecord);
}

/** FR-3.2: ratings in fixed period order (Most Recent, Prior Rating, Two Year Prior Rating); `limit` must be a positive integer. */
export function getLastRatings(employeeId: string, limit = 3): RatingRecord[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }
  const rows = getConnection()
    .prepare<
      [string, number],
      RatingRow
    >(`SELECT * FROM rating_history WHERE employee_id = ? ORDER BY ${RATING_PERIOD_ORDER_SQL} LIMIT ?`)
    .all(employeeId, limit);
  return rows.map(toRatingRecord);
}

/**
 * FR-4.1: complete rating history, in fixed period order. Equivalent to
 * `getLastRatings(employeeId, 3)` by construction, since the table can
 * never hold more than 3 rows per employee (FR-3.1) — kept as a separate
 * function for API-shape consistency with `getSalaryHistory`.
 */
export function getRatingHistory(employeeId: string): RatingRecord[] {
  const rows = getConnection()
    .prepare<
      [string],
      RatingRow
    >(`SELECT * FROM rating_history WHERE employee_id = ? ORDER BY ${RATING_PERIOD_ORDER_SQL}`)
    .all(employeeId);
  return rows.map(toRatingRecord);
}

/**
 * AR-2.3 (spec 005): every stored external manager, unfiltered — the table
 * is bounded by the number of distinct unresolved supervisor ids ever seen
 * across all imports, so it never needs a filtered query of its own.
 */
export function getAllExternalManagers(): ExternalManager[] {
  const rows = getConnection().prepare<[], ExternalManagerRow>("SELECT * FROM external_managers").all();
  return rows.map(toExternalManager);
}

/**
 * Current manager choices are imported active employees with at least one
 * active direct report. External placeholders and contractors are never
 * selectable. Duplicate human labels are deliberately marked unavailable;
 * callers must not guess between them using the opaque reference.
 */
export function getCurrentManagerOptions(): ContractorManagerOption[] {
  const activePeople = getAllEmployees({ workerType: "all" });
  const employeeManagerIds = new Set(
    activePeople.map((employee) => employee.managerId).filter((id): id is string => id !== null),
  );
  const employeeManagers = activePeople
    .filter((employee) => employee.workerType === "employee" && employeeManagerIds.has(employee.id))
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      position: employee.position,
      country: employee.country,
      selectable: true,
    }));
  const labelKey = (manager: Omit<ContractorManagerOption, "selectable">): string =>
    `${manager.name.trim().toLocaleLowerCase()}\u0000${manager.position.trim().toLocaleLowerCase()}\u0000${manager.country.trim().toLocaleLowerCase()}`;
  const counts = new Map<string, number>();
  for (const manager of employeeManagers) counts.set(labelKey(manager), (counts.get(labelKey(manager)) ?? 0) + 1);
  return employeeManagers
    .map((manager) => ({ ...manager, selectable: counts.get(labelKey(manager)) === 1 }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.position.localeCompare(b.position) || a.country.localeCompare(b.country) || a.id.localeCompare(b.id));
}
