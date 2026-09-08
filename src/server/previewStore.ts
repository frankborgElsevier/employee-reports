import * as fs from "node:fs";
import * as crypto from "node:crypto";

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
/** Generous margin over any realistic preview computation time (the real 43-row reference file processes in well under 100ms; even a full 5,000-row/25MB file is expected to take seconds, not minutes). */
const DEFAULT_RESERVATION_TIMEOUT_MS = 2 * 60 * 1000;

/** Testing affordance — overrides FR-5.2's 5-minute default so expiry can be exercised without a real 5-minute wait. */
let tokenTtlMs = DEFAULT_TOKEN_TTL_MS;

/** Testing affordance — overrides the 2-minute reservation timeout so a stuck-computation reap can be exercised quickly. */
let reservationTimeoutMs = DEFAULT_RESERVATION_TIMEOUT_MS;

export function setTokenTtlMsForTesting(ttlMs: number | null): void {
  tokenTtlMs = ttlMs ?? DEFAULT_TOKEN_TTL_MS;
}

export function setReservationTimeoutMsForTesting(timeoutMs: number | null): void {
  reservationTimeoutMs = timeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS;
}

type Slot =
  | { status: "idle" }
  | { status: "computing"; ticket: string; reservedAt: number }
  | { status: "ready"; token: string; filePath: string; capturedAt: Date; expiresAt: number };

let slot: Slot = { status: "idle" };

function cleanupFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // best-effort cleanup — AR-4.4's startup sweep is the backstop.
  }
}

/**
 * FR-5.2: reaps both ways a reservation can go stale without ever being
 * released by the request that made it — a confirmable import whose token
 * expired unconfirmed, and a preview computation that reserved the slot but
 * never finished (a stalled upload, a hung parse, a dropped connection
 * multer never reported). Neither case may block imports indefinitely.
 */
function reapIfExpired(): void {
  if (slot.status === "ready" && Date.now() > slot.expiresAt) {
    cleanupFile(slot.filePath);
    slot = { status: "idle" };
    return;
  }
  if (slot.status === "computing" && Date.now() - slot.reservedAt > reservationTimeoutMs) {
    slot = { status: "idle" };
  }
}

/**
 * FR-5.2: atomically checks and reserves the single in-flight slot in one
 * synchronous call. There is no `await` between the check and the
 * reservation — unlike a separate "is it free?" query followed later by a
 * "claim it" write, which leaves a window where two concurrent requests can
 * both see the slot as free before either claims it. Returns a ticket the
 * caller must present to `finalizeReservation`/`releaseReservation` if the
 * slot was free, or `null` if a preview computation or a confirmable
 * pending import already occupies it.
 */
export function tryReserve(): string | null {
  reapIfExpired();
  if (slot.status !== "idle") return null;
  const ticket = crypto.randomUUID();
  slot = { status: "computing", ticket, reservedAt: Date.now() };
  return ticket;
}

/**
 * Converts a reservation into a confirmable pending import once a preview
 * computation succeeds (FR-4.3). Returns `null` instead of a token if
 * `ticket` no longer matches the current reservation — it timed out and was
 * reaped (and possibly claimed by someone else) while this call was still
 * running; the caller must not treat that as a success.
 */
export function finalizeReservation(ticket: string, filePath: string, capturedAt: Date): string | null {
  if (slot.status !== "computing" || slot.ticket !== ticket) return null;
  const token = crypto.randomUUID();
  slot = { status: "ready", token, filePath, capturedAt, expiresAt: Date.now() + tokenTtlMs };
  return token;
}

/**
 * Releases a reservation whose preview computation failed. A no-op if
 * `ticket` no longer matches the current reservation (already reaped),
 * so a very late release can't clear a different, newer reservation.
 */
export function releaseReservation(ticket: string): void {
  if (slot.status === "computing" && slot.ticket === ticket) {
    slot = { status: "idle" };
  }
}

export interface ClaimedImport {
  filePath: string;
  capturedAt: Date;
}

/**
 * FR-4.4: atomically retrieves and clears the pending import for `token` in
 * one synchronous call. Because the slot is emptied in the same call that
 * reads it — before any `await` — a second confirm request for the same
 * token (even one arriving very close behind the first) finds an empty slot
 * and gets null, rather than both requests independently re-running and
 * committing the same import. Returns null, without changing state, if the
 * token doesn't match or has expired.
 */
export function claimPendingImport(token: string): ClaimedImport | null {
  reapIfExpired();
  if (slot.status === "ready" && slot.token === token) {
    const { filePath, capturedAt } = slot;
    slot = { status: "idle" };
    return { filePath, capturedAt };
  }
  return null;
}

/** Deletes a file the caller has already claimed or released responsibility for (AR-4.2). */
export function cleanupRetainedFile(filePath: string): void {
  cleanupFile(filePath);
}

/** Test-only: forces the slot back to idle, cleaning up any retained file. */
export function resetForTesting(): void {
  if (slot.status === "ready") {
    cleanupFile(slot.filePath);
  }
  slot = { status: "idle" };
}
