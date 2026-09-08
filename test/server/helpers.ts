import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Server } from "node:http";
import { closeDatabase, initDatabase } from "../../src/db/connection.js";
import { createApp, type CreateAppOptions } from "../../src/server/app.js";

export interface TestServer {
  baseUrl: string;
  uploadDir: string;
}

export async function withTestServer<T>(
  run: (server: TestServer) => Promise<T>,
  appOptions: CreateAppOptions = {},
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workday-server-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  const uploadDir = path.join(dir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  initDatabase(dbPath);

  const app = createApp(uploadDir, appOptions);
  let server: Server;
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server!.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await run({ baseUrl, uploadDir });
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function originHeader(baseUrl: string, origin?: string | null): Record<string, string> {
  if (origin === null) return {};
  return { Origin: origin ?? baseUrl };
}

export async function postPreview(
  baseUrl: string,
  filePath: string,
  options: { origin?: string | null; fieldName?: string } = {},
): Promise<Response> {
  const buffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append(options.fieldName ?? "file", new Blob([buffer]), "upload.xlsx");
  return fetch(`${baseUrl}/api/preview`, {
    method: "POST",
    body: formData,
    headers: originHeader(baseUrl, options.origin),
  });
}

export async function postConfirm(
  baseUrl: string,
  token: string,
  options: { origin?: string | null } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...originHeader(baseUrl, options.origin) },
    body: JSON.stringify({ token }),
  });
}
