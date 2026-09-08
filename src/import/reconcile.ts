import {
  deleteRatingRecord,
  getAllEmployees,
  getEmployeeById,
  reassignManager,
  runInTransaction,
  setExternalManager,
  upsertEmployee,
  upsertExternalManager,
  upsertRatingRecord,
  upsertSalaryRecord,
} from "../db/index.js";
import { RATING_PERIODS } from "../db/types.js";
import type { ImportRow, ReconciliationCounts } from "./types.js";

/** Internal signal used to force AR-5.1's transaction to roll back on a successful preview (FR-4.3). */
class PreviewAbort extends Error {
  constructor(public readonly counts: ReconciliationCounts) {
    super("preview-abort");
  }
}

function toIsoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * FR-2.1-FR-2.3, FR-3.1-FR-3.3: the reconciliation itself. Always runs the
 * same sequence — upsert present employees, reassign managers, write
 * salary/ratings, then soft-inactivate anyone absent — regardless of
 * whether the caller will commit or roll back the surrounding transaction.
 */
function doReconcile(rows: ImportRow[], now: Date): ReconciliationCounts {
  const effectiveYear = now.getUTCFullYear();
  const inactivationDate = toIsoDate(now);

  const existingIdsBeforeImport = new Set(getAllEmployees().map((employee) => employee.id));
  let added = 0;
  let updated = 0;

  // FR-2.1: upsert every present employee, reactivating anyone returning (endDate cleared to null).
  for (const row of rows) {
    if (existingIdsBeforeImport.has(row.employeeId)) {
      updated++;
    } else {
      added++;
    }
    upsertEmployee({
      id: row.employeeId,
      name: row.name,
      position: row.position,
      country: row.country,
      endDate: null,
    });
  }

  // FR-2.2 (spec 005), Step A: aggregate a winning external-manager name per
  // unresolved supervisor id BEFORE any external_managers write, so the
  // parent row exists before any employee references it (AR-2.2 — PRAGMA
  // foreign_keys = ON). Each row's supervisor resolution is cached here and
  // reused in Step B below, so the two steps can never disagree about which
  // ids are unresolved.
  const resolvedSupervisor = new Map<ImportRow, ReturnType<typeof getEmployeeById>>();
  const namesByUnresolvedId = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.supervisorId === null) continue;
    const possibleSupervisor = getEmployeeById(row.supervisorId);
    const supervisor = possibleSupervisor?.workerType === "employee" ? possibleSupervisor : null;
    resolvedSupervisor.set(row, supervisor);
    if (supervisor !== null || row.supervisorName === null) continue;
    const counts = namesByUnresolvedId.get(row.supervisorId) ?? new Map<string, number>();
    counts.set(row.supervisorName, (counts.get(row.supervisorName) ?? 0) + 1);
    namesByUnresolvedId.set(row.supervisorId, counts);
  }

  const idsWithWinningName = new Set<string>();
  for (const [unresolvedId, counts] of namesByUnresolvedId) {
    // Most-frequent name wins; ties (including a group of exactly one) are
    // broken by whichever name sorts first via localeCompare.
    const [winningName] = [...counts.entries()].sort(
      ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB),
    )[0];
    upsertExternalManager(unresolvedId, winningName);
    idsWithWinningName.add(unresolvedId);
  }

  // FR-2.3 (spec 005), Step B: per-row link, replacing the plain
  // manager-reassignment loop. Runs after Step A so every external_managers
  // row a row might reference already exists.
  for (const row of rows) {
    if (row.supervisorId === null) {
      reassignManager(row.employeeId, null);
      setExternalManager(row.employeeId, null);
      continue;
    }
    const supervisor = resolvedSupervisor.get(row) ?? null;
    if (supervisor) {
      reassignManager(row.employeeId, supervisor.id);
      setExternalManager(row.employeeId, null);
    } else {
      reassignManager(row.employeeId, null); // unchanged from today
      setExternalManager(row.employeeId, idsWithWinningName.has(row.supervisorId) ? row.supervisorId : null);
    }
  }

  // FR-1.5: salary snapshot; FR-3.1-FR-3.3: ratings, replaced and stale periods removed.
  for (const row of rows) {
    // AR-2.3 (spec 006): row.compRatio rides along on the same call, same row.
    upsertSalaryRecord(row.employeeId, effectiveYear, row.currency, row.baseSalary, row.bonus, row.compRatio);
    for (const period of RATING_PERIODS) {
      const value = row.ratings[period];
      if (value === undefined) {
        deleteRatingRecord(row.employeeId, period);
      } else {
        upsertRatingRecord(row.employeeId, period, value);
      }
    }
  }

  // FR-2.3: soft-inactivate every currently-active employee absent from the file.
  const fileIds = new Set(rows.map((row) => row.employeeId));
  let inactivated = 0;
  for (const employee of getAllEmployees()) {
    if (fileIds.has(employee.id)) continue;
    upsertEmployee({
      id: employee.id,
      name: employee.name,
      position: employee.position,
      country: employee.country,
      endDate: inactivationDate,
    });
    inactivated++;
  }

  return { added, updated, inactivated };
}

/**
 * AR-5.1: runs the reconciliation inside a single transaction. `options.commit`
 * decides whether that transaction commits or is deliberately rolled back
 * (FR-4.3's preview step) — the reconciliation logic itself has no separate
 * "preview mode". AR-5.3: `now` is captured once by the caller and reused for
 * every date/year this reconciliation writes.
 */
export function reconcile(rows: ImportRow[], options: { commit: boolean }, now: Date): ReconciliationCounts {
  try {
    return runInTransaction(() => {
      const counts = doReconcile(rows, now);
      if (!options.commit) {
        throw new PreviewAbort(counts);
      }
      return counts;
    });
  } catch (error) {
    if (error instanceof PreviewAbort) {
      return error.counts;
    }
    throw error;
  }
}
