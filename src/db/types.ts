export interface Employee {
  id: string;
  name: string;
  position: string;
  country: string;
  workerType: WorkerType;
  endDate: string | null;
  managerId: string | null;
  externalManagerId: string | null;
}

export const WORKER_TYPES = ["employee", "contractor"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

/** AR-2.1 (spec 005): a manager referenced by import data who has no employee row of their own. */
export interface ExternalManager {
  id: string;
  name: string;
}

export interface EmployeeInput {
  id: string;
  name: string;
  position: string;
  country: string;
  endDate?: string | null;
}

export interface ContractorInput {
  name: string;
  position: string;
  country: string;
  managerId?: string | null;
}

/** The manual details editable from the contractor table. */
export interface ContractorUpdateInput {
  name: string;
  position: string;
  country: string;
}

/** An imported employee eligible to become a contractor's line manager. */
export interface ContractorManagerOption {
  /** Opaque database reference; callers must not use this as display data. */
  id: string;
  name: string;
  position: string;
  country: string;
  selectable: boolean;
}

export interface SalaryRecord {
  employeeId: string;
  effectiveYear: number;
  currency: string;
  baseSalary: number;
  bonus: number;
  /**
   * FR-2.2 (spec 006): independently nullable, unlike
   * currency/baseSalary/bonus — a salary row can exist with no compa ratio.
   */
  compRatio: number | null;
}

export const RATING_PERIODS = ["Most Recent", "Prior Rating", "Two Year Prior Rating"] as const;

export type RatingPeriod = (typeof RATING_PERIODS)[number];

export interface RatingRecord {
  employeeId: string;
  ratingPeriod: RatingPeriod;
  ratingValue: string;
}

export interface QueryOptions {
  includeInactive?: boolean;
  workerType?: WorkerType | "all";
}
