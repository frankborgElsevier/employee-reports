import type { RatingPeriod } from "../db/types.js";

/** FR-1.1: every header this spec's mapping depends on; all must be present, exactly once. */
export const REQUIRED_HEADERS = [
  "Employee ID",
  "Preferred Name",
  "Business Title",
  "Location Country",
  "Direct Supervisor ID",
  "Worker Currency",
  "Worker Total Base Pay Amount",
  "Worker Total Target Cash Amount",
  "Performance Rating - Most Recent",
  "Performance Rating - Prior Rating",
  "Performance Rating - Two Year Prior Rating",
] as const;

/** FR-3.1: which rating column maps to which fixed period label. */
export const RATING_COLUMN_TO_PERIOD: Record<string, RatingPeriod> = {
  "Performance Rating - Most Recent": "Most Recent",
  "Performance Rating - Prior Rating": "Prior Rating",
  "Performance Rating - Two Year Prior Rating": "Two Year Prior Rating",
};

/** AR-4.5: files beyond this many non-blank data rows are rejected before mapping runs. */
export const MAX_DATA_ROWS = 5000;
