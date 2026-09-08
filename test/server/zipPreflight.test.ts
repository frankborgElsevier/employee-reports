import assert from "node:assert/strict";
import { test } from "node:test";
import { preflightZip } from "../../src/server/zipPreflight.js";
import { LimitExceededError, WorkbookStructureError } from "../../src/import/errors.js";
import { buildWorkbookFile, cleanupFile, defaultRow, writeRawFile } from "../import/helpers.js";

test("AR-4.6: a well-formed .xlsx passes the preflight with default limits", async () => {
  const filePath = await buildWorkbookFile([defaultRow()]);
  try {
    await assert.doesNotReject(() => preflightZip(filePath));
  } finally {
    cleanupFile(filePath);
  }
});

test("AR-4.6: a non-zip file is rejected as an unparseable workbook", async () => {
  const filePath = writeRawFile("not a zip file at all");
  try {
    await assert.rejects(() => preflightZip(filePath), WorkbookStructureError);
  } finally {
    cleanupFile(filePath);
  }
});

test("AR-4.6: exceeding the entry-count limit is rejected before any entry is decompressed", async () => {
  const filePath = await buildWorkbookFile([defaultRow()]);
  try {
    await assert.rejects(() => preflightZip(filePath, { maxEntryCount: 1 }), LimitExceededError);
  } finally {
    cleanupFile(filePath);
  }
});

test("AR-4.6: exceeding the per-entry uncompressed-size limit is rejected", async () => {
  const filePath = await buildWorkbookFile([defaultRow()]);
  try {
    await assert.rejects(() => preflightZip(filePath, { maxEntryUncompressedBytes: 10 }), LimitExceededError);
  } finally {
    cleanupFile(filePath);
  }
});

test("AR-4.6: exceeding the total uncompressed-size limit is rejected", async () => {
  const filePath = await buildWorkbookFile([defaultRow()]);
  try {
    await assert.rejects(
      () => preflightZip(filePath, { maxEntryUncompressedBytes: 1_000_000, maxTotalUncompressedBytes: 10 }),
      LimitExceededError,
    );
  } finally {
    cleanupFile(filePath);
  }
});
