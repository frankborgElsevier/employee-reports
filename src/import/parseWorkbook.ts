import ExcelJS from "exceljs";
import type { RatingPeriod } from "../db/types.js";
import { RowValidationError, WorkbookStructureError, LimitExceededError } from "./errors.js";
import { MAX_DATA_ROWS, RATING_COLUMN_TO_PERIOD, REQUIRED_HEADERS } from "./mapping.js";
import type { ImportRow } from "./types.js";

/**
 * Headers this parser reads if present but never requires — deliberately not in
 * `REQUIRED_HEADERS`, so a file lacking them still imports (FR-2.1 spec 005 for
 * "Direct Supervisor Name"; FR-2.1 spec 006 for "Base Pay Compa Ratio"). A
 * *duplicated* optional header is still rejected as ambiguous, exactly like a
 * duplicated required one.
 */
const OPTIONAL_HEADERS = ["Direct Supervisor Name", "Base Pay Compa Ratio"] as const;

function isBlankCell(value: ExcelJS.CellValue): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/** FR-1.2, FR-1.3: every text field this spec reads must be a plain string cell. */
function requireStringCell(value: ExcelJS.CellValue, context: string): string {
  if (typeof value !== "string") {
    throw new RowValidationError(`${context} must be text, not a number or other type.`);
  }
  return value.trim();
}

function requireNonBlankString(value: ExcelJS.CellValue, context: string): string {
  const text = requireStringCell(value, context);
  if (text === "") {
    throw new RowValidationError(`${context} is blank.`);
  }
  return text;
}

/** FR-1.5: numeric fields must be ExcelJS's plain numeric cell.value, not a formula/string/blank. */
function requireNumberCell(value: ExcelJS.CellValue, context: string): number {
  if (typeof value !== "number") {
    throw new RowValidationError(`${context} must be a number.`);
  }
  return value;
}

/**
 * FR-1.1: reads the uploaded file's first worksheet, validates its headers,
 * and maps every data row into a validated ImportRow (FR-1.2-FR-1.5).
 */
export async function parseWorkbook(filePath: string): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    throw new WorkbookStructureError("The uploaded file could not be opened as a valid Excel workbook.");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new WorkbookStructureError("The uploaded file has no worksheets.");
  }

  const headerToColumn = new Map<string, number>();
  const duplicateHeaders = new Set<string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (typeof cell.value !== "string") return;
    const header = cell.value.trim();
    if (headerToColumn.has(header)) {
      duplicateHeaders.add(header);
    } else {
      headerToColumn.set(header, colNumber);
    }
  });

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerToColumn.has(header));
  if (missingHeaders.length > 0) {
    throw new WorkbookStructureError(`Missing required column(s): ${missingHeaders.join(", ")}.`);
  }
  // FR-2.1 (spec 005), FR-2.1 (spec 006): "Direct Supervisor Name" and
  // "Base Pay Compa Ratio" are optional (not in REQUIRED_HEADERS, so a missing
  // column is fine), but a duplicate of either is rejected exactly like a
  // duplicated required header.
  const ambiguousHeaders = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS].filter((header) =>
    duplicateHeaders.has(header),
  );
  if (ambiguousHeaders.length > 0) {
    throw new WorkbookStructureError(`Column header(s) appear more than once: ${ambiguousHeaders.join(", ")}.`);
  }

  const columnOf = (header: string): number => {
    const col = headerToColumn.get(header);
    if (col === undefined) throw new Error(`Internal error: header ${header} was not resolved.`);
    return col;
  };

  // AR-4.5: the row-count cap is enforced before the mapping loop runs, in its own pass.
  let dataRowCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
    if (rowNumber !== 1) dataRowCount++;
  });
  if (dataRowCount === 0) {
    throw new WorkbookStructureError("The uploaded file has no data rows.");
  }
  if (dataRowCount > MAX_DATA_ROWS) {
    throw new LimitExceededError(`File has ${dataRowCount} data rows; the maximum is ${MAX_DATA_ROWS}.`);
  }

  const rows: ImportRow[] = [];
  const seenIds = new Set<string>();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const context = `row ${rowNumber}`;

    const employeeId = requireNonBlankString(row.getCell(columnOf("Employee ID")).value, `${context}: Employee ID`);
    if (seenIds.has(employeeId)) {
      throw new RowValidationError(`Duplicate Employee ID ${JSON.stringify(employeeId)} found in the file.`);
    }
    seenIds.add(employeeId);

    const name = requireNonBlankString(row.getCell(columnOf("Preferred Name")).value, `${context}: Preferred Name`);
    const position = requireNonBlankString(row.getCell(columnOf("Business Title")).value, `${context}: Business Title`);
    const country = requireNonBlankString(row.getCell(columnOf("Location Country")).value, `${context}: Location Country`);

    const supervisorRaw = row.getCell(columnOf("Direct Supervisor ID")).value;
    const supervisorId = isBlankCell(supervisorRaw)
      ? null
      : requireNonBlankString(supervisorRaw, `${context}: Direct Supervisor ID`);

    // FR-2.1 (spec 005): optional column — absent entirely means null for every row.
    const supervisorName = !headerToColumn.has("Direct Supervisor Name")
      ? null
      : isBlankCell(row.getCell(columnOf("Direct Supervisor Name")).value)
        ? null
        : requireNonBlankString(row.getCell(columnOf("Direct Supervisor Name")).value, `${context}: Direct Supervisor Name`);

    const currency = requireNonBlankString(row.getCell(columnOf("Worker Currency")).value, `${context}: Worker Currency`);
    const baseSalary = requireNumberCell(
      row.getCell(columnOf("Worker Total Base Pay Amount")).value,
      `${context}: Worker Total Base Pay Amount`,
    );
    const targetCash = requireNumberCell(
      row.getCell(columnOf("Worker Total Target Cash Amount")).value,
      `${context}: Worker Total Target Cash Amount`,
    );
    const bonus = targetCash - baseSalary;
    if (bonus < 0) {
      throw new RowValidationError(
        `${context}: derived bonus is negative (Worker Total Target Cash Amount is less than Worker Total Base Pay Amount).`,
      );
    }

    // FR-2.1 (spec 006): optional column — absent entirely means null for every
    // row; a blank cell means null for that row; a present, non-numeric cell is
    // rejected by requireNumberCell exactly as a malformed required numeric
    // column already is.
    const compRatio = !headerToColumn.has("Base Pay Compa Ratio")
      ? null
      : isBlankCell(row.getCell(columnOf("Base Pay Compa Ratio")).value)
        ? null
        : requireNumberCell(
            row.getCell(columnOf("Base Pay Compa Ratio")).value,
            `${context}: Base Pay Compa Ratio`,
          );

    const ratings: Partial<Record<RatingPeriod, string>> = {};
    for (const [header, period] of Object.entries(RATING_COLUMN_TO_PERIOD)) {
      const cellValue = row.getCell(columnOf(header)).value;
      if (isBlankCell(cellValue)) continue;
      ratings[period] = requireNonBlankString(cellValue, `${context}: ${header}`);
    }

    rows.push({
      employeeId,
      name,
      position,
      country,
      supervisorId,
      supervisorName,
      currency,
      baseSalary,
      bonus,
      compRatio,
      ratings,
    });
  });

  return rows;
}
