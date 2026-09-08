import * as crypto from "node:crypto";
import type { Database } from "better-sqlite3";
import { getConnection } from "./connection.js";
import { ConflictError, CycleError, NotFoundError, ValidationError } from "./errors.js";
import { RATING_PERIODS, type ContractorInput, type ContractorUpdateInput, type Employee, type EmployeeInput, type RatingPeriod } from "./types.js";
import {
  currentCalendarYear,
  isBlank,
  isFiniteNonNegative,
  isValidCurrencyCode,
  isValidIsoDate,
  isValidYear,
  roundToTwoDecimals,
} from "./validation.js";

function assertEmployeeExists(db: Database, employeeId: string): void {
  const row = db.prepare("SELECT 1 FROM employees WHERE id = ?").get(employeeId);
  if (!row) {
    throw new NotFoundError(`No employee exists with id ${JSON.stringify(employeeId)}.`);
  }
}

function validateEmployeeInput(employee: EmployeeInput): void {
  if (isBlank(employee.id)) throw new ValidationError("id must not be blank.");
  if (isBlank(employee.name)) throw new ValidationError("name must not be blank.");
  if (isBlank(employee.position)) throw new ValidationError("position must not be blank.");
  if (isBlank(employee.country)) throw new ValidationError("country must not be blank.");
  if (employee.endDate != null && !isValidIsoDate(employee.endDate)) {
    throw new ValidationError(`endDate ${JSON.stringify(employee.endDate)} is not a valid ISO 8601 date.`);
  }
}

/**
 * FR-4.3: creates or updates an employee's identifying/date fields.
 * Deliberately has no `managerId` field — see reassignManager (FR-1.4).
 */
export function upsertEmployee(employee: EmployeeInput): void {
  validateEmployeeInput(employee);
  const db = getConnection();
  const existing = db.prepare<[string], { worker_type: string }>("SELECT worker_type FROM employees WHERE id = ?").get(employee.id);
  if (existing?.worker_type === "contractor") {
    throw new ConflictError(`Employee id ${JSON.stringify(employee.id)} is reserved for a contractor.`);
  }
  db.prepare(
    `INSERT INTO employees (id, name, position, country, end_date)
     VALUES (@id, @name, @position, @country, @endDate)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       position = excluded.position,
       country = excluded.country,
       end_date = excluded.end_date`,
  ).run({ ...employee, endDate: employee.endDate ?? null });
}

function wouldCreateCycle(db: Database, employeeId: string, newManagerId: string): boolean {
  const getManagerId = db.prepare<[string], { manager_id: string | null }>(
    "SELECT manager_id FROM employees WHERE id = ?",
  );
  let current: string | null = newManagerId;
  while (current !== null) {
    if (current === employeeId) return true;
    const row = getManagerId.get(current);
    current = row ? row.manager_id : null;
  }
  return false;
}

/**
 * FR-1.4, FR-4.3: the only function that may set or change `manager_id`.
 * Rejects a change that would make an employee their own manager, directly
 * or transitively.
 */
export function reassignManager(employeeId: string, newManagerId: string | null): void {
  const db = getConnection();
  const run = db.transaction((id: string, managerId: string | null) => {
    assertEmployeeExists(db, id);
    if (managerId !== null) {
      assertEmployeeExists(db, managerId);
      const manager = db.prepare<[string], { worker_type: string }>("SELECT worker_type FROM employees WHERE id = ?").get(managerId);
      if (manager?.worker_type !== "employee") {
        throw new ValidationError("A contractor cannot be assigned as a line manager.");
      }
      if (wouldCreateCycle(db, id, managerId)) {
        throw new CycleError(
          `Assigning ${JSON.stringify(managerId)} as the manager of ${JSON.stringify(id)} would create a cycle.`,
        );
      }
    }
    db.prepare("UPDATE employees SET manager_id = ? WHERE id = ?").run(managerId, id);
  });
  run(employeeId, newManagerId);
}

function validateContractorInput(contractor: ContractorInput): void {
  if (isBlank(contractor.name) || isBlank(contractor.position) || isBlank(contractor.country)) {
    throw new ValidationError("name, position, and country must not be blank.");
  }
}

function assertCurrentContractorManager(db: Database, managerId: string): void {
  const employee = db
    .prepare<[string], { worker_type: string; end_date: string | null; name: string; position: string; country: string }>(
      "SELECT worker_type, end_date, name, position, country FROM employees WHERE id = ?",
    )
    .get(managerId);
  const hasActiveDirectReport = db
    .prepare<[string], { 1: number }>("SELECT 1 FROM employees WHERE manager_id = ? AND end_date IS NULL LIMIT 1")
    .get(managerId);
  if (!employee || employee.worker_type !== "employee" || employee.end_date !== null || !hasActiveDirectReport) {
    throw new ValidationError("manager must identify a current manager.");
  }
  const indistinguishableManagers = db.prepare<
    [string, string, string],
    { count: number }
  >(
    `SELECT COUNT(*) AS count
       FROM employees
      WHERE worker_type = 'employee'
        AND end_date IS NULL
        AND manager_id IN (SELECT id FROM employees WHERE end_date IS NULL)
        AND lower(trim(name)) = lower(trim(?))
        AND lower(trim(position)) = lower(trim(?))
        AND lower(trim(country)) = lower(trim(?))`,
  ).get(employee.name, employee.position, employee.country);
  if ((indistinguishableManagers?.count ?? 0) > 1) {
    throw new ValidationError("manager must identify an unambiguous current manager.");
  }
}

/** Creates one manually managed contractor and optionally assigns a current manager. */
export function createContractor(contractor: ContractorInput): Employee {
  validateContractorInput(contractor);
  const db = getConnection();
  const run = db.transaction(() => {
    const managerId = contractor.managerId ?? null;
    if (managerId !== null) assertCurrentContractorManager(db, managerId);
    const id = `contractor:${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO employees (id, name, position, country, worker_type, end_date, manager_id, external_manager_id)
       VALUES (?, ?, ?, ?, 'contractor', NULL, ?, NULL)`,
    ).run(id, contractor.name.trim(), contractor.position.trim(), contractor.country.trim(), managerId);
    return {
      id,
      name: contractor.name.trim(),
      position: contractor.position.trim(),
      country: contractor.country.trim(),
      workerType: "contractor" as const,
      endDate: null,
      managerId,
      externalManagerId: null,
    };
  });
  return run();
}

function getActiveContractorOrThrow(db: Database, contractorId: string): void {
  const contractor = db.prepare<[string], { worker_type: string; end_date: string | null }>("SELECT worker_type, end_date FROM employees WHERE id = ?").get(contractorId);
  if (!contractor || contractor.worker_type !== "contractor" || contractor.end_date !== null) {
    throw new NotFoundError("No active contractor exists with that id.");
  }
}

function readEmployee(db: Database, contractorId: string): Employee {
  const row = db.prepare<[string], { id: string; name: string; position: string; country: string; worker_type: "contractor"; end_date: string | null; manager_id: string | null; external_manager_id: string | null }>("SELECT * FROM employees WHERE id = ?").get(contractorId)!;
  return { id: row.id, name: row.name, position: row.position, country: row.country, workerType: row.worker_type, endDate: row.end_date, managerId: row.manager_id, externalManagerId: row.external_manager_id };
}

/** Atomically updates manual contractor details, retaining its manager relationship. */
export function updateContractorDetails(contractorId: string, update: ContractorUpdateInput): Employee {
  validateContractorInput({ ...update });
  const db = getConnection();
  return db.transaction(() => {
    getActiveContractorOrThrow(db, contractorId);
    db.prepare("UPDATE employees SET name = ?, position = ?, country = ? WHERE id = ?").run(update.name.trim(), update.position.trim(), update.country.trim(), contractorId);
    return readEmployee(db, contractorId);
  })();
}

/** Revalidates and atomically changes only an active contractor's manager. */
export function setContractorManager(contractorId: string, managerId: string | null): Employee {
  const db = getConnection();
  return db.transaction(() => {
    getActiveContractorOrThrow(db, contractorId);
    if (managerId !== null) assertCurrentContractorManager(db, managerId);
    db.prepare("UPDATE employees SET manager_id = ?, external_manager_id = NULL WHERE id = ?").run(managerId, contractorId);
    return readEmployee(db, contractorId);
  })();
}

/** Permanently removes one active contractor and its cascade-owned history. */
export function deleteContractor(contractorId: string): void {
  const db = getConnection();
  db.transaction(() => {
    getActiveContractorOrThrow(db, contractorId);
    db.prepare("DELETE FROM employees WHERE id = ? AND worker_type = 'contractor' AND end_date IS NULL").run(contractorId);
  })();
}

function validateSalaryRecord(
  effectiveYear: number,
  currency: string,
  baseSalary: number,
  bonus: number,
  compRatio: number | null,
): void {
  if (!isValidYear(effectiveYear)) {
    throw new ValidationError(
      `effectiveYear ${effectiveYear} must be an integer in the inclusive range [1990, ${currentCalendarYear() + 1}].`,
    );
  }
  if (!isValidCurrencyCode(currency)) {
    throw new ValidationError(`currency ${JSON.stringify(currency)} must be a 3-letter uppercase code.`);
  }
  if (!isFiniteNonNegative(baseSalary)) {
    throw new ValidationError("baseSalary must be a finite number that is not negative.");
  }
  if (!isFiniteNonNegative(bonus)) {
    throw new ValidationError("bonus must be a finite number that is not negative.");
  }
  // FR-2.2 (spec 006): checked only when supplied — null is a valid, meaningful
  // value here (no compa ratio known for this snapshot), unlike the three
  // fields above.
  if (compRatio !== null && !isFiniteNonNegative(compRatio)) {
    throw new ValidationError("compRatio must be a finite number that is not negative.");
  }
}

/** FR-2.3, FR-4.3, AR-2.3: creates or updates one salary snapshot per employee/year. */
export function upsertSalaryRecord(
  employeeId: string,
  effectiveYear: number,
  currency: string,
  baseSalary: number,
  bonus = 0,
  compRatio: number | null = null,
): void {
  validateSalaryRecord(effectiveYear, currency, baseSalary, bonus, compRatio);
  const db = getConnection();
  const run = db.transaction(() => {
    assertEmployeeExists(db, employeeId);
    db.prepare(
      `INSERT INTO salary_history (employee_id, effective_year, currency, base_salary, bonus, comp_ratio)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, effective_year) DO UPDATE SET
         currency = excluded.currency,
         base_salary = excluded.base_salary,
         bonus = excluded.bonus,
         comp_ratio = excluded.comp_ratio`,
    ).run(
      employeeId,
      effectiveYear,
      currency,
      roundToTwoDecimals(baseSalary),
      roundToTwoDecimals(bonus),
      // AR-2.2 (spec 006): deliberately NOT rounded — a ratio, not a currency
      // amount; rounding 1.141603 to 1.14 would discard meaningful precision.
      compRatio,
    );
  });
  run();
}

function isValidRatingPeriod(value: string): value is RatingPeriod {
  return (RATING_PERIODS as readonly string[]).includes(value);
}

function validateRatingRecord(ratingPeriod: string, ratingValue: string): void {
  if (!isValidRatingPeriod(ratingPeriod)) {
    throw new ValidationError(
      `ratingPeriod ${JSON.stringify(ratingPeriod)} must be one of ${RATING_PERIODS.join(", ")}.`,
    );
  }
  if (isBlank(ratingValue)) {
    throw new ValidationError("ratingValue must not be blank.");
  }
  if (ratingValue.length > 200) {
    throw new ValidationError("ratingValue must not exceed 200 characters.");
  }
}

/** FR-3.3, FR-4.3: creates or updates one rating per employee/period. */
export function upsertRatingRecord(employeeId: string, ratingPeriod: RatingPeriod, ratingValue: string): void {
  validateRatingRecord(ratingPeriod, ratingValue);
  const db = getConnection();
  const run = db.transaction(() => {
    assertEmployeeExists(db, employeeId);
    db.prepare(
      `INSERT INTO rating_history (employee_id, rating_period, rating_value)
       VALUES (?, ?, ?)
       ON CONFLICT(employee_id, rating_period) DO UPDATE SET
         rating_value = excluded.rating_value`,
    ).run(employeeId, ratingPeriod, ratingValue);
  });
  run();
}

/** FR-4.3: removes the rating for one employee/period, if one exists (a no-op otherwise). */
export function deleteRatingRecord(employeeId: string, ratingPeriod: RatingPeriod): void {
  if (!isValidRatingPeriod(ratingPeriod)) {
    throw new ValidationError(
      `ratingPeriod ${JSON.stringify(ratingPeriod)} must be one of ${RATING_PERIODS.join(", ")}.`,
    );
  }
  const db = getConnection();
  const run = db.transaction(() => {
    assertEmployeeExists(db, employeeId);
    db.prepare("DELETE FROM rating_history WHERE employee_id = ? AND rating_period = ?").run(
      employeeId,
      ratingPeriod,
    );
  });
  run();
}

/**
 * AR-2.2 (spec 005): creates or fully replaces the stored name for an
 * external manager id. An upsert, not an exists-check-then-branch, matching
 * `upsertEmployee`/`upsertSalaryRecord`/`upsertRatingRecord` above — a stale
 * name from an earlier import can never outlive an updated one.
 */
export function upsertExternalManager(id: string, name: string): void {
  if (isBlank(id)) throw new ValidationError("id must not be blank.");
  if (isBlank(name)) throw new ValidationError("name must not be blank.");
  const db = getConnection();
  db.prepare(
    `INSERT INTO external_managers (id, name)
     VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  ).run(id, name);
}

/**
 * FR-2.3, AR-2.2 (spec 005): the only function that may write
 * `employees.external_manager_id`, mirroring `reassignManager`'s role for
 * `manager_id` above. No cycle check is needed — external managers are not
 * real employees, so no cycle is possible through this column.
 */
export function setExternalManager(employeeId: string, externalManagerId: string | null): void {
  const db = getConnection();
  const run = db.transaction((id: string, managerId: string | null) => {
    assertEmployeeExists(db, id);
    if (managerId !== null) {
      const row = db.prepare("SELECT 1 FROM external_managers WHERE id = ?").get(managerId);
      if (!row) {
        throw new NotFoundError(`No external manager exists with id ${JSON.stringify(managerId)}.`);
      }
    }
    db.prepare("UPDATE employees SET external_manager_id = ? WHERE id = ?").run(managerId, id);
  });
  run(employeeId, externalManagerId);
}

/** FR-1.6, FR-4.4: deletes an employee with no direct reports, cascading their history. */
export function deleteEmployee(employeeId: string): void {
  const db = getConnection();
  const run = db.transaction(() => {
    assertEmployeeExists(db, employeeId);
    const hasReports = db.prepare("SELECT 1 FROM employees WHERE manager_id = ?").get(employeeId);
    if (hasReports) {
      throw new ConflictError(
        `Cannot delete employee ${JSON.stringify(employeeId)}: they still have direct reports.`,
      );
    }
    db.prepare("DELETE FROM employees WHERE id = ?").run(employeeId);
  });
  run();
}
