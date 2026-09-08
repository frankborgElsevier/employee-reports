import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import open from "open";
import { initDatabase } from "../db/index.js";
import { createApp } from "./app.js";

// Defensive backstop: the async callbacks in app.ts's routes are invoked by
// multer/plain IIFEs, not Express's own router, so Express 5's automatic
// promise-rejection forwarding doesn't apply to them. An exception escaping
// their existing try/catch (e.g. an unexpected error during cleanup) would
// otherwise crash the whole process (Node's default since v15). Log and keep
// running instead — a local single-user tool restarting mid-import is worse
// than one request failing without a response.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled rejection (server continues running):", reason);
});

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const dataDir = path.join(projectRoot, "data");
const uploadDir = path.join(dataDir, "tmp-uploads");
const dbPath = path.join(dataDir, "employees.sqlite");
const PORT = 3200;

// AR-4.4: create the data directory (mkdirSync is idempotent, avoiding the
// existsSync-then-mkdir TOCTOU race), then bootstrap the database.
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

// AR-4.2: sweep any temp upload left over from a crashed prior run.
for (const entry of fs.readdirSync(uploadDir)) {
  fs.rmSync(path.join(uploadDir, entry), { force: true });
}

initDatabase(dbPath);

const app = createApp(uploadDir);

// Bind to the documented local port so bookmarked application URLs stay valid.
const server = app.listen(PORT, "127.0.0.1", () => {
  const serverUrl = `http://127.0.0.1:${PORT}`;
  // eslint-disable-next-line no-console
  console.log(`WorkDay Import server running at ${serverUrl}`);
  void open(serverUrl);
});
