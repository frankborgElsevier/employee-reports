import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { REQUIRED_HEADERS } from "../../src/import/mapping.js";

export type TestRowData = Record<string, ExcelJS.CellValue>;

export function defaultRow(overrides: TestRowData = {}): TestRowData {
  return {
    "Employee ID": "1001",
    "Preferred Name": "Alice Example",
    "Business Title": "Engineer",
    "Location Country": "United States of America",
    "Direct Supervisor ID": "9999",
    "Worker Currency": "USD",
    "Worker Total Base Pay Amount": 100000,
    "Worker Total Target Cash Amount": 110000,
    "Performance Rating - Most Recent": "Exceeds",
    "Performance Rating - Prior Rating": "Meets",
    "Performance Rating - Two Year Prior Rating": "Meets",
    ...overrides,
  };
}

export interface BuildWorkbookOptions {
  headers?: string[];
  dropHeader?: string;
  duplicateHeader?: string;
}

/** Builds a temp .xlsx file from row data, returning its path. Caller owns cleanup. */
export async function buildWorkbookFile(rows: TestRowData[], options: BuildWorkbookOptions = {}): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");

  let headers = options.headers ?? [...REQUIRED_HEADERS];
  if (options.dropHeader) headers = headers.filter((header) => header !== options.dropHeader);
  if (options.duplicateHeader) headers = [...headers, options.duplicateHeader];

  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(headers.map((header) => row[header]));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workday-import-test-"));
  const filePath = path.join(dir, "test.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/** Writes an arbitrary buffer as a file with a .xlsx extension, for malformed-file tests. */
export function writeRawFile(contents: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workday-import-test-"));
  const filePath = path.join(dir, "test.xlsx");
  fs.writeFileSync(filePath, contents);
  return filePath;
}

export function cleanupFile(filePath: string): void {
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
}
