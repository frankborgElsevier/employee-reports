import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { closeDatabase, initDatabase } from "../../src/db/connection.js";

export function withFreshDatabase<T>(run: (dbPath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-foundation-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  initDatabase(dbPath);
  try {
    return run(dbPath);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
