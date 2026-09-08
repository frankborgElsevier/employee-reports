/** FR-1.1: the file itself can't be read as a workbook, or is missing/duplicates a required header. Maps to HTTP 400 (FR-4.3) — the server couldn't even attempt a preview. */
export class WorkbookStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookStructureError";
  }
}

/** AR-4.5/AR-4.6: the upload exceeds a size, row-count, or ZIP-entry bound. Maps to HTTP 413 (FR-4.3). */
export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitExceededError";
  }
}

/** FR-1.2-FR-1.5, FR-1.4: a specific row's content is invalid. Maps to a "would fail" preview outcome (HTTP 200, FR-4.3), the same bucket as a spec 001 ValidationError/CycleError raised during reconciliation. */
export class RowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowValidationError";
  }
}
