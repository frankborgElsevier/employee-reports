import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkbook } from "../../src/import/parseWorkbook.js";
import { LimitExceededError, RowValidationError, WorkbookStructureError } from "../../src/import/errors.js";
import { REQUIRED_HEADERS } from "../../src/import/mapping.js";
import { buildWorkbookFile, cleanupFile, defaultRow, writeRawFile } from "./helpers.js";

test("FR-1.1: a well-formed file parses into one row per data row", async () => {
  const filePath = await buildWorkbookFile([defaultRow(), defaultRow({ "Employee ID": "1002" })]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].employeeId, "1001");
    assert.equal(rows[1].employeeId, "1002");
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.1: a missing required header is rejected, naming it", async () => {
  const filePath = await buildWorkbookFile([defaultRow()], { dropHeader: "Direct Supervisor ID" });
  try {
    await assert.rejects(() => parseWorkbook(filePath), (error: unknown) => {
      assert.ok(error instanceof WorkbookStructureError);
      assert.match((error as Error).message, /Direct Supervisor ID/);
      return true;
    });
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.1: a duplicated required header is rejected as ambiguous", async () => {
  const filePath = await buildWorkbookFile([defaultRow()], { duplicateHeader: "Employee ID" });
  try {
    await assert.rejects(() => parseWorkbook(filePath), WorkbookStructureError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.1: a non-xlsx file is rejected as an unparseable workbook", async () => {
  const filePath = writeRawFile("this,is,a,csv\n1,2,3,4\n");
  try {
    await assert.rejects(() => parseWorkbook(filePath), WorkbookStructureError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.1: a file with a header row but zero data rows is rejected", async () => {
  const filePath = await buildWorkbookFile([]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), WorkbookStructureError);
  } finally {
    cleanupFile(filePath);
  }
});

test("AR-4.5: a file with more than 5,000 data rows is rejected", async () => {
  const rows = Array.from({ length: 5001 }, (_, i) => defaultRow({ "Employee ID": String(2000 + i) }));
  const filePath = await buildWorkbookFile(rows);
  try {
    await assert.rejects(() => parseWorkbook(filePath), LimitExceededError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.3: a blank Employee ID is rejected", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Employee ID": "" })]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.4: a duplicate Employee ID within the file is rejected, naming it", async () => {
  const filePath = await buildWorkbookFile([defaultRow(), defaultRow()]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), (error: unknown) => {
      assert.ok(error instanceof RowValidationError);
      assert.match((error as Error).message, /1001/);
      return true;
    });
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.2: a blank Direct Supervisor ID parses to a null supervisorId", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Direct Supervisor ID": "" })]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].supervisorId, null);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.5: base pay and target cash produce the derived bonus", async () => {
  const filePath = await buildWorkbookFile([
    defaultRow({ "Worker Total Base Pay Amount": 151604.94, "Worker Total Target Cash Amount": 166765.43 }),
  ]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].baseSalary, 151604.94);
    assert.ok(Math.abs(rows[0].bonus - (166765.43 - 151604.94)) < 1e-9);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.5: a row with no bonus plan (target cash equal to base pay) yields bonus 0", async () => {
  const filePath = await buildWorkbookFile([
    defaultRow({ "Worker Total Base Pay Amount": 90000, "Worker Total Target Cash Amount": 90000 }),
  ]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].bonus, 0);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.5: target cash less than base pay (negative derived bonus) is rejected", async () => {
  const filePath = await buildWorkbookFile([
    defaultRow({ "Worker Total Base Pay Amount": 90000, "Worker Total Target Cash Amount": 80000 }),
  ]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.5: a non-numeric salary cell is rejected", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Worker Total Base Pay Amount": "not a number" })]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.2: a formula cell in a text field is rejected, not stringified", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Preferred Name": { formula: "1+1", result: 2 } })]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-1.3: an Employee ID stored as a plain number (leading zeros already lost) is rejected", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Employee ID": 1001 })]);
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: Direct Supervisor ID and Direct Supervisor Name both populated map to both fields", async () => {
  const filePath = await buildWorkbookFile(
    [defaultRow({ "Direct Supervisor ID": "00000270149", "Direct Supervisor Name": "Frank Borg" })],
    { headers: [...REQUIRED_HEADERS, "Direct Supervisor Name"] },
  );
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].supervisorId, "00000270149");
    assert.equal(rows[0].supervisorName, "Frank Borg");
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a file lacking the Direct Supervisor Name column imports with supervisorName null on every row", async () => {
  const filePath = await buildWorkbookFile([defaultRow(), defaultRow({ "Employee ID": "1002" })]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].supervisorName, null);
    assert.equal(rows[1].supervisorName, null);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a blank/whitespace-only Direct Supervisor Name cell maps to null, not an error", async () => {
  const filePath = await buildWorkbookFile(
    [defaultRow({ "Direct Supervisor Name": "   " })],
    { headers: [...REQUIRED_HEADERS, "Direct Supervisor Name"] },
  );
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].supervisorName, null);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a duplicated Direct Supervisor Name header is rejected the same as a duplicated required header", async () => {
  const filePath = await buildWorkbookFile(
    [defaultRow({ "Direct Supervisor Name": "Frank Borg" })],
    { headers: [...REQUIRED_HEADERS, "Direct Supervisor Name"], duplicateHeader: "Direct Supervisor Name" },
  );
  try {
    await assert.rejects(() => parseWorkbook(filePath), (error: unknown) => {
      assert.ok(error instanceof WorkbookStructureError);
      assert.match((error as Error).message, /Direct Supervisor Name/);
      return true;
    });
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a non-string value in a populated Direct Supervisor Name cell is rejected", async () => {
  const filePath = await buildWorkbookFile(
    [defaultRow({ "Direct Supervisor Name": { formula: "1+1", result: 2 } })],
    { headers: [...REQUIRED_HEADERS, "Direct Supervisor Name"] },
  );
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a populated numeric Base Pay Compa Ratio cell maps to compRatio unrounded", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Base Pay Compa Ratio": 1.141603 })], {
    headers: [...REQUIRED_HEADERS, "Base Pay Compa Ratio"],
  });
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].compRatio, 1.141603);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a file lacking the Base Pay Compa Ratio column imports with compRatio null on every row", async () => {
  const filePath = await buildWorkbookFile([defaultRow(), defaultRow({ "Employee ID": "1002" })]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].compRatio, null);
    assert.equal(rows[1].compRatio, null);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a blank Base Pay Compa Ratio cell maps to null, not an error", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Base Pay Compa Ratio": "" })], {
    headers: [...REQUIRED_HEADERS, "Base Pay Compa Ratio"],
  });
  try {
    const rows = await parseWorkbook(filePath);
    assert.equal(rows[0].compRatio, null);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a non-numeric text value in a populated Base Pay Compa Ratio cell rejects the import", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Base Pay Compa Ratio": "not a number" })], {
    headers: [...REQUIRED_HEADERS, "Base Pay Compa Ratio"],
  });
  try {
    // Same error class as a malformed Worker Total Base Pay Amount cell above.
    await assert.rejects(() => parseWorkbook(filePath), (error: unknown) => {
      assert.ok(error instanceof RowValidationError);
      assert.match((error as Error).message, /Base Pay Compa Ratio/);
      return true;
    });
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a formula value in a populated Base Pay Compa Ratio cell rejects the import", async () => {
  const filePath = await buildWorkbookFile(
    [defaultRow({ "Base Pay Compa Ratio": { formula: "1+1", result: 2 } })],
    { headers: [...REQUIRED_HEADERS, "Base Pay Compa Ratio"] },
  );
  try {
    await assert.rejects(() => parseWorkbook(filePath), RowValidationError);
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-2.1: a duplicated Base Pay Compa Ratio header is rejected as appearing more than once", async () => {
  const filePath = await buildWorkbookFile([defaultRow({ "Base Pay Compa Ratio": 1.141603 })], {
    headers: [...REQUIRED_HEADERS, "Base Pay Compa Ratio"],
    duplicateHeader: "Base Pay Compa Ratio",
  });
  try {
    await assert.rejects(() => parseWorkbook(filePath), (error: unknown) => {
      assert.ok(error instanceof WorkbookStructureError);
      assert.match((error as Error).message, /appear more than once/);
      assert.match((error as Error).message, /Base Pay Compa Ratio/);
      return true;
    });
  } finally {
    cleanupFile(filePath);
  }
});

test("FR-3.1: rating columns map to their fixed period labels, blank columns omitted", async () => {
  const filePath = await buildWorkbookFile([
    defaultRow({
      "Performance Rating - Most Recent": "Exceeds",
      "Performance Rating - Prior Rating": "Meets",
      "Performance Rating - Two Year Prior Rating": "",
    }),
  ]);
  try {
    const rows = await parseWorkbook(filePath);
    assert.deepEqual(rows[0].ratings, { "Most Recent": "Exceeds", "Prior Rating": "Meets" });
  } finally {
    cleanupFile(filePath);
  }
});
