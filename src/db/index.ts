export { initDatabase, closeDatabase, runInTransaction } from "./connection.js";
export {
  getEmployeeById,
  getAllEmployees,
  getDescendants,
  getAncestors,
  getCurrentSalary,
  getSalaryHistory,
  getLastRatings,
  getRatingHistory,
  getAllExternalManagers,
  getCurrentManagerOptions,
  getActiveContractors,
} from "./queries.js";
export {
  upsertEmployee,
  createContractor,
  updateContractorDetails,
  setContractorManager,
  deleteContractor,
  reassignManager,
  upsertSalaryRecord,
  upsertRatingRecord,
  deleteRatingRecord,
  deleteEmployee,
  upsertExternalManager,
  setExternalManager,
} from "./mutations.js";
export * from "./types.js";
export * from "./errors.js";
