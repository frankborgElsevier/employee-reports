import type { RatingPeriod } from "../db/types.js";

/** One validated, mapped row from the uploaded file (FR-1.2). */
export interface ImportRow {
  employeeId: string;
  name: string;
  position: string;
  country: string;
  /** FR-2.2: null means the cell was blank — no lookup is attempted. */
  supervisorId: string | null;
  /** FR-2.1 (spec 005): optional column; null when absent, blank, or whitespace-only. */
  supervisorName: string | null;
  currency: string;
  baseSalary: number;
  /** FR-1.5: Worker Total Target Cash Amount minus Worker Total Base Pay Amount. */
  bonus: number;
  /**
   * FR-2.1 (spec 006): optional `Base Pay Compa Ratio` column; null when the
   * column is absent from the file entirely, or when the row's cell is blank.
   */
  compRatio: number | null;
  ratings: Partial<Record<RatingPeriod, string>>;
}

/** The counts shown in the preview/result screen. */
export interface ReconciliationCounts {
  added: number;
  updated: number;
  inactivated: number;
}
