import yauzl from "yauzl";
import { LimitExceededError, WorkbookStructureError } from "../import/errors.js";

const DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_COUNT = 200;

export interface ZipPreflightLimits {
  maxEntryUncompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxEntryCount?: number;
}

/**
 * AR-4.6: inspects the uploaded file's ZIP central directory — entry sizes
 * and count — without decompressing any entry, before ExcelJS (AR-1.1) ever
 * opens the file. ExcelJS's buffer-based API decompresses everything up
 * front with no hook to check size first, so this check has to happen here.
 * `limits` defaults to the real AR-4.6 bounds; overriding it is a testing
 * affordance so the boundary conditions can be exercised without fixture
 * files hundreds of megabytes in size.
 */
export function preflightZip(filePath: string, limits: ZipPreflightLimits = {}): Promise<void> {
  const maxEntryUncompressedBytes = limits.maxEntryUncompressedBytes ?? DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES;
  const maxTotalUncompressedBytes = limits.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxEntryCount = limits.maxEntryCount ?? DEFAULT_MAX_ENTRY_COUNT;

  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(new WorkbookStructureError("The uploaded file could not be opened as a valid Excel workbook."));
        return;
      }

      if (zipfile.entryCount > maxEntryCount) {
        zipfile.close();
        reject(
          new LimitExceededError(`File has ${zipfile.entryCount} internal entries; the maximum is ${maxEntryCount}.`),
        );
        return;
      }

      let totalUncompressedBytes = 0;
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(error);
      };

      zipfile.on("entry", (entry) => {
        if (settled) return;
        if (entry.uncompressedSize > maxEntryUncompressedBytes) {
          fail(new LimitExceededError(`File contains an entry too large when decompressed: ${entry.fileName}.`));
          return;
        }
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > maxTotalUncompressedBytes) {
          fail(new LimitExceededError("File is too large when fully decompressed."));
          return;
        }
        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        if (settled) return;
        settled = true;
        resolve();
      });

      zipfile.on("error", () => {
        fail(new WorkbookStructureError("The uploaded file could not be opened as a valid Excel workbook."));
      });

      zipfile.readEntry();
    });
  });
}
