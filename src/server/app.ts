import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  createContractor,
  getActiveContractors,
  getAllEmployees,
  getAllExternalManagers,
  getCurrentManagerOptions,
  getCurrentSalary,
  getEmployeeById,
  getLastRatings,
  updateContractorDetails,
  setContractorManager,
  deleteContractor,
  NotFoundError,
  ValidationError,
} from "../db/index.js";
import type { Employee, RatingRecord } from "../db/index.js";
import { parseWorkbook } from "../import/parseWorkbook.js";
import { reconcile } from "../import/reconcile.js";
import { LimitExceededError, WorkbookStructureError } from "../import/errors.js";
import { preflightZip } from "./zipPreflight.js";
import { claimPendingImport, cleanupRetainedFile, finalizeReservation, releaseReservation, tryReserve } from "./previewStore.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

/** AR-4.5: 25 MB compressed file-size limit; a single file per request. */
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * A "would-fail" preview/confirm outcome: a row-content problem (FR-1.2-FR-1.5,
 * FR-1.4) or a spec 001 error raised during reconciliation (ValidationError,
 * CycleError, NotFoundError, ConflictError). Distinguished from the
 * WorkbookStructureError/LimitExceededError cases, which fail the HTTP
 * request itself (400/413) rather than reporting a preview outcome (FR-4.3).
 */
function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/** AR-4.3: rejects a request whose Origin header is missing or doesn't match this server's own origin. */
function checkOrigin(req: Request, res: Response, next: NextFunction): void {
  const expected = `${req.protocol}://${req.get("host") ?? ""}`;
  const origin = req.get("origin");
  if (!origin || origin !== expected) {
    res.status(403).json({ error: "Cross-origin request rejected." });
    return;
  }
  next();
}

function parseContractorJson(req: Request, res: Response, next: NextFunction): void {
  express.json()(req, res, (error: unknown) => {
    if (error) {
      res.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    next();
  });
}

interface ContractorRequestBody {
  name: string;
  position: string;
  country: string;
  managerId?: string | null;
}

function isContractorRequestBody(body: unknown): body is ContractorRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.name === "string" &&
    typeof value.position === "string" &&
    typeof value.country === "string" &&
    (value.managerId === undefined || value.managerId === null || typeof value.managerId === "string")
  );
}

interface ContractorDetailsRequestBody {
  name: string;
  position: string;
  country: string;
}

function isContractorDetailsRequestBody(body: unknown): body is ContractorDetailsRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  return typeof value.name === "string" && typeof value.position === "string" && typeof value.country === "string";
}

interface ContractorManagerRequestBody {
  managerId: string | null;
}

function isContractorManagerRequestBody(body: unknown): body is ContractorManagerRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  return value.managerId === null || typeof value.managerId === "string";
}

function contractorManagerDescriptor(employee: Employee): { id: string; name: string; position: string; country: string } | null {
  if (employee.managerId !== null) {
    // The active-only manager options are deliberately not the source of this
    // persisted relationship. A later import can inactivate the manager while
    // the contractor keeps their manual assignment; returning it here lets
    // the UI retain that stale choice rather than silently submit `null`.
    const manager = getEmployeeById(employee.managerId);
    return manager?.workerType === "employee"
      ? { id: manager.id, name: manager.name, position: manager.position, country: manager.country }
      : null;
  }
  return null;
}

function contractorProjection(employee: Employee) {
  return {
    id: employee.id,
    name: employee.name,
    position: employee.position,
    country: employee.country,
    manager: contractorManagerDescriptor(employee),
  };
}

function contractorErrorResponse(error: unknown, res: Response, fallback: string): void {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: "Contractor not found." });
    return;
  }
  if (error instanceof ValidationError) {
    const isManagerError = error.message === "manager must identify a current manager.";
    res.status(400).json({
      error: isManagerError
        ? "That line manager is no longer current. Reload the manager options and choose a current manager."
        : fallback,
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.error("Contractor request failed:", error);
  res.status(500).json({ error: fallback });
}

interface EmployeeDetailsRatings {
  mostRecent: string | null;
  priorRating: string | null;
  twoYearPriorRating: string | null;
}

/** Spec 004 FR-4.2: `rating_period` string -> camelCase payload key. */
const RATING_PERIOD_TO_KEY: Record<string, keyof EmployeeDetailsRatings> = {
  "Most Recent": "mostRecent",
  "Prior Rating": "priorRating",
  "Two Year Prior Rating": "twoYearPriorRating",
};

/**
 * Spec 004 FR-4.2: `getLastRatings` omits any period with no row rather than
 * padding it (spec 001 FR-3.2); this fills each of the three named keys with
 * `null` when no corresponding row exists, rather than leaving the key out.
 */
function mapRatings(ratings: RatingRecord[]): EmployeeDetailsRatings {
  const result: EmployeeDetailsRatings = { mostRecent: null, priorRating: null, twoYearPriorRating: null };
  for (const rating of ratings) {
    result[RATING_PERIOD_TO_KEY[rating.ratingPeriod]] = rating.ratingValue;
  }
  return result;
}

export interface CreateAppOptions {
  /** Testing affordance — overrides AR-4.5's 25 MB default so the limit can be exercised with a small fixture. */
  maxUploadBytes?: number;
}

export function createApp(uploadDir: string, options: CreateAppOptions = {}): Express {
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.xlsx`),
    }),
    limits: { fileSize: maxUploadBytes, files: 1 },
  });

  const app = express();

  // The root URL is a data-aware entry point: returning users land on the
  // report they normally need, while a first-time user goes directly to import.
  app.get("/", (_req: Request, res: Response) => {
    try {
      const hasActivePeople = getAllEmployees({ workerType: "all" }).length > 0;
      res.redirect(hasActivePeople ? "/headcount.html" : "/index.html");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("GET / landing page selection failed:", error);
      res.redirect("/index.html");
    }
  });
  app.use(express.static(PUBLIC_DIR));

  // Spec 003 FR-3.1: the Headcount Dashboard's only data source. Read-only, so
  // AR-3.2 gives it no checkOrigin guard (no state change, no CSRF risk) and
  // adds no CORS headers — without Access-Control-Allow-Origin the browser's
  // default policy already stops another page reading the roster off this port.
  app.get("/api/headcount", (_req: Request, res: Response) => {
    try {
      // FR-3.1, FR-3.2: an explicit projection, not the Employee object
      // passed through — that would also serialise `endDate`, and this
      // screen has no use for salary, ratings, or employment status.
      const employees = getAllEmployees({ workerType: "all" });

      // FR-2.4, AR-2.3: the set of external-manager ids actually referenced
      // by an active employee's `externalManagerId`, computed in application
      // code (no dynamic SQL `IN` clause, no new injection surface) rather
      // than a filtered query, since `external_managers` is small enough to
      // read in full every time (AR-2.3).
      const referencedExternalIds = new Set(
        employees
          .map((employee) => employee.externalManagerId)
          .filter((id): id is string => id !== null),
      );
      const realEmployeeIds = new Set(employees.map((employee) => employee.id));

      // FR-2.4: defensive guard against an external id ever coinciding with a
      // real employee id — should be prevented by the import layer's
      // self-healing (FR-2.3), but guarded here too.
      const externalManagers = getAllExternalManagers()
        .filter((manager) => referencedExternalIds.has(manager.id) && !realEmployeeIds.has(manager.id))
        .sort((a, b) => a.id.localeCompare(b.id));

      // FR-2.4: real employee entries keep today's `id ASC` order and
      // position; `managerId` is unified to a single effective-parent value
      // (`manager_id` if set, otherwise `external_manager_id`).
      const employeePayload = employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        position: employee.position,
        country: employee.country,
        managerId: employee.managerId ?? employee.externalManagerId,
        isExternal: false,
        isContractor: employee.workerType === "contractor",
      }));
      // FR-2.4: external manager entries are appended after all real
      // employee entries, ordered by `id ASC`.
      const externalPayload = externalManagers.map((manager) => ({
        id: manager.id,
        name: manager.name,
        position: null,
        country: null,
        managerId: null,
        isExternal: true,
        isContractor: false,
      }));

      res.status(200).json({ employees: [...employeePayload, ...externalPayload] });
    } catch (error) {
      // AR-3.4: a fixed, generic client message — unlike the import routes,
      // whose messages are user-actionable validation feedback, nothing here
      // is actionable, and echoing the real error would risk leaking internal
      // detail such as filesystem paths into a browser-readable response.
      // eslint-disable-next-line no-console
      console.error("GET /api/headcount failed:", error);
      res.status(500).json({ error: "Could not load employee data." });
    }
  });

  // Spec 004 FR-4.1: the Employee Details screen's only data source. Read-only,
  // so it carries the same no-checkOrigin/no-CORS reasoning as /api/headcount
  // (AR-4.1), but unlike that endpoint it exposes compensation and rating
  // data, so AR-4.4 adds a Cache-Control header no other route here needs.
  app.get("/api/employee-details", (_req: Request, res: Response) => {
    // AR-4.4: set unconditionally, before the try, so "every response" (200
    // or 500) carries it without duplicating the call in both branches.
    res.set("Cache-Control", "no-store");
    try {
      // FR-4.1, FR-4.2: an explicit nine-field projection (FR-2.3 spec 006
      // added `compRatio` between `bonus` and `ratings` — the key order here is
      // the client's column order), not the Employee object passed through —
      // that would also serialise `country` and `endDate`, neither of which
      // belongs in this payload.
      const employees = getAllEmployees({ workerType: "all" }).map((employee) => {
        const salary = employee.workerType === "employee" ? getCurrentSalary(employee.id) : null;
        return {
          id: employee.id,
          name: employee.name,
          position: employee.position,
          workerType: employee.workerType,
          managerId: employee.managerId,
          currency: salary ? salary.currency : null,
          baseSalary: salary ? salary.baseSalary : null,
          bonus: salary ? salary.bonus : null,
          compRatio: salary ? salary.compRatio : null,
          ratings: employee.workerType === "employee" ? mapRatings(getLastRatings(employee.id, 3)) : mapRatings([]),
        };
      });
      res.status(200).json({ employees });
    } catch (error) {
      // AR-4.3: same fixed, generic message and server-side-only logging as
      // /api/headcount's identical catch-all.
      // eslint-disable-next-line no-console
      console.error("GET /api/employee-details failed:", error);
      res.status(500).json({ error: "Could not load employee data." });
    }
  });

  app.get("/api/contractor-form-options", (_req: Request, res: Response) => {
    try {
      const positions = [...new Set(getAllEmployees({ workerType: "all" }).map((employee) => employee.position))].sort((a, b) =>
        a.localeCompare(b),
      );
      res.status(200).json({ managers: getCurrentManagerOptions(), positions });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("GET /api/contractor-form-options failed:", error);
      res.status(500).json({ error: "Could not load manager options." });
    }
  });

  app.get("/api/contractors", (_req: Request, res: Response) => {
    try {
      res.status(200).json({ contractors: getActiveContractors().map(contractorProjection) });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("GET /api/contractors failed:", error);
      res.status(500).json({ error: "Could not load contractors." });
    }
  });

  app.post("/api/contractors", checkOrigin, parseContractorJson, (req: Request, res: Response) => {
    if (!isContractorRequestBody(req.body)) {
      res.status(400).json({ error: "Enter a name, position, and country." });
      return;
    }
    try {
      const contractor = createContractor(req.body);
      res.status(201).json({ contractor: contractorProjection(contractor) });
    } catch (error) {
      contractorErrorResponse(error, res, "Enter a name, position, and country.");
    }
  });

  app.put("/api/contractors/:contractorId/details", checkOrigin, parseContractorJson, (req: Request, res: Response) => {
    if (!isContractorDetailsRequestBody(req.body)) {
      res.status(400).json({ error: "Enter a name, position, and country." });
      return;
    }
    const contractorId = req.params.contractorId;
    if (typeof contractorId !== "string") {
      res.status(404).json({ error: "Contractor not found." });
      return;
    }
    try {
      const contractor = updateContractorDetails(contractorId, req.body);
      res.status(200).json({ contractor: contractorProjection(contractor) });
    } catch (error) {
      contractorErrorResponse(error, res, "Enter a name, position, and country.");
    }
  });

  app.put("/api/contractors/:contractorId/manager", checkOrigin, parseContractorJson, (req: Request, res: Response) => {
    if (!isContractorManagerRequestBody(req.body)) {
      res.status(400).json({ error: "Choose a current line manager." });
      return;
    }
    const contractorId = req.params.contractorId;
    if (typeof contractorId !== "string") {
      res.status(404).json({ error: "Contractor not found." });
      return;
    }
    try {
      const contractor = setContractorManager(contractorId, req.body.managerId);
      res.status(200).json({ contractor: contractorProjection(contractor) });
    } catch (error) {
      contractorErrorResponse(error, res, "Choose a current line manager.");
    }
  });

  app.delete("/api/contractors/:contractorId", checkOrigin, (req: Request, res: Response) => {
    const contractorId = req.params.contractorId;
    if (typeof contractorId !== "string") {
      res.status(404).json({ error: "Contractor not found." });
      return;
    }
    try {
      deleteContractor(contractorId);
      res.status(204).end();
    } catch (error) {
      contractorErrorResponse(error, res, "Could not delete contractor. Try again.");
    }
  });

  // FR-4.2, FR-4.3: upload triggers a rolled-back preview computation, never a direct commit.
  app.post("/api/preview", checkOrigin, (req: Request, res: Response) => {
    // FR-5.2: reserved synchronously, before any await — closes the race where
    // two concurrent uploads could both see the slot as free (see spec's
    // Change Log / implementation-review.md for why a separate check-then-set
    // pair was not sufficient). The reservation also self-expires (see
    // previewStore.ts) if this request never reaches finalizeReservation or
    // releaseReservation at all — e.g. a stalled upload — so a single hung
    // request can't block every future import indefinitely.
    const ticket = tryReserve();
    if (!ticket) {
      res.status(409).json({ error: "Another import is already in progress." });
      return;
    }

    upload.single("file")(req, res, async (uploadError: unknown) => {
      if (uploadError) {
        releaseReservation(ticket);
        const isSizeLimit =
          uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE";
        res.status(isSizeLimit ? 413 : 400).json({ error: describeFailure(uploadError) });
        return;
      }
      if (!req.file) {
        releaseReservation(ticket);
        res.status(400).json({ error: "No file was uploaded under the expected field name." });
        return;
      }

      const filePath = req.file.path;
      try {
        await preflightZip(filePath);
        const rows = await parseWorkbook(filePath);
        const capturedAt = new Date();
        const reconciliation = reconcile(rows, { commit: false }, capturedAt);
        const counts = reconciliation;
        const token = finalizeReservation(ticket, filePath, capturedAt);
        if (!token) {
          // This reservation timed out and was reaped (FR-5.2) before the
          // computation finished — don't report success for a slot that may
          // now belong to a different, newer import.
          fs.rmSync(filePath, { force: true });
          res.status(408).json({ error: "Import took too long and timed out; please try again." });
          return;
        }
        res.status(200).json({ outcome: "success", counts, token });
      } catch (error) {
        fs.rmSync(filePath, { force: true });
        releaseReservation(ticket);
        if (error instanceof WorkbookStructureError) {
          res.status(400).json({ error: describeFailure(error) });
          return;
        }
        if (error instanceof LimitExceededError) {
          res.status(413).json({ error: describeFailure(error) });
          return;
        }
        // A row-content or spec 001 validation/integrity error: the preview
        // itself succeeded in determining this import would fail (FR-4.3).
        res.status(200).json({ outcome: "failure", error: describeFailure(error) });
      }
    });
  });

  // FR-4.4: commits the previously-computed preview, referenced by its token.
  app.post("/api/confirm", checkOrigin, express.json(), (req: Request, res: Response) => {
    // Atomically claims and clears the slot in one synchronous call, so a
    // second confirm for the same token — even one arriving immediately
    // behind the first — finds nothing to claim, rather than both requests
    // independently re-running and committing the same import.
    const token = typeof req.body?.token === "string" ? req.body.token : null;
    const claimed = token ? claimPendingImport(token) : null;
    if (!claimed) {
      res.status(400).json({ error: "Unknown or expired import token." });
      return;
    }

    void (async () => {
      try {
        const rows = await parseWorkbook(claimed.filePath);
        const reconciliation = reconcile(rows, { commit: true }, claimed.capturedAt);
        const counts = reconciliation;
        cleanupRetainedFile(claimed.filePath);
        res.status(200).json({ outcome: "success", counts });
      } catch (error) {
        cleanupRetainedFile(claimed.filePath);
        if (error instanceof WorkbookStructureError || error instanceof LimitExceededError) {
          res.status(400).json({ error: describeFailure(error) });
          return;
        }
        res.status(200).json({ outcome: "failure", error: describeFailure(error) });
      }
    })();
  });

  return app;
}
