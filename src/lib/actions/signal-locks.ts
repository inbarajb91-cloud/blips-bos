"use server";

import { and, eq, sql } from "drizzle-orm";
import { db, signalLocks, signals, users } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";

/**
 * Signal lock actions — Phase 7E.
 *
 * Purpose: prevent two users from editing the same signal at the same
 * time. Today at single-user BLIPS scale it's mostly a forward-looking
 * safety net for DECK (employee portal). But wiring it now means the
 * mechanics are in place when multi-user actually arrives, not
 * retrofitted later when something starts breaking.
 *
 * Model:
 *   - One row per signal (UNIQUE on signal_id)
 *   - Lock has locked_by (users.id) + expires_at (30 min default)
 *   - Expired locks can be taken over by any user
 *   - Owner can renew by re-acquiring
 *   - On tab close / navigation, owner explicitly releases
 *
 * Concurrency:
 *   - acquireSignalLock uses INSERT ... ON CONFLICT DO UPDATE with a
 *     WHERE that only allows the update when (a) the existing lock is
 *     expired or (b) it's owned by the same user re-acquiring. Two
 *     concurrent acquires from different users can't both succeed;
 *     one wins, the other reads the authoritative state.
 */

const LOCK_DURATION_MINUTES = 30;

export interface LockStatus {
  /** Does the current user hold this signal's edit lock? */
  heldByMe: boolean;
  /** Auth user id of whoever holds the lock (or null if none). */
  lockedByAuthId: string | null;
  /** Email of the lock holder, for display. Null if no lock held. */
  lockedByEmail: string | null;
  /** When the current lock expires. Null if no lock held. */
  expiresAt: Date | null;
}

/**
 * Acquire a lock on a signal. Returns the resulting lock status:
 *   - If no lock existed → new lock created, heldByMe=true
 *   - If existing lock was mine → renewed, heldByMe=true
 *   - If existing lock was someone else's + expired → taken over, heldByMe=true
 *   - If existing lock was someone else's + not expired → heldByMe=false,
 *     status reflects the other holder
 */
export async function acquireSignalLock(signalId: string): Promise<LockStatus> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Scope check: signal must belong to user's org before touching locks
  const [signal] = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.orgId, user.orgId)))
    .limit(1);
  if (!signal) throw new Error("Signal not found");

  // INSERT ... ON CONFLICT DO UPDATE: the WHERE clause on the UPDATE
  // means the row only changes when (a) same user re-acquiring or
  // (b) existing lock has expired. If someone else holds a fresh lock,
  // the UPDATE is skipped and RETURNING yields zero rows — we detect
  // that and fall through to read the authoritative state.
  const rows = await db.execute(sql`
    INSERT INTO signal_locks (signal_id, locked_by, locked_at, expires_at)
    VALUES (
      ${signalId}::uuid,
      ${user.authId}::uuid,
      NOW(),
      NOW() + INTERVAL '${sql.raw(String(LOCK_DURATION_MINUTES))} minutes'
    )
    ON CONFLICT (signal_id) DO UPDATE
      SET locked_by = EXCLUDED.locked_by,
          locked_at = EXCLUDED.locked_at,
          expires_at = EXCLUDED.expires_at
      WHERE signal_locks.locked_by = EXCLUDED.locked_by
         OR signal_locks.expires_at < NOW()
    RETURNING locked_by, expires_at
  `);

  // When the UPDATE WHERE fails (someone else has a live lock), the
  // RETURNING yields zero rows. We then read the existing lock to
  // report back who holds it + until when.
  if (rows.length === 0) {
    return readLockStatus(signalId, user.authId);
  }

  // UPDATE succeeded — I hold the lock. Read it back via normal join
  // so the email comes through without a second round-trip.
  return readLockStatus(signalId, user.authId);
}

/**
 * Renew an existing lock held by the current user. Safe to call
 * repeatedly — extends expires_at by another 30 minutes.
 *
 * If the lock was taken over by someone else (user stepped away long
 * enough for it to expire + a different user took it), returns the
 * new holder's status rather than silently stealing it back.
 */
export async function renewSignalLock(signalId: string): Promise<LockStatus> {
  // Same mechanics as acquire — the WHERE clause naturally handles
  // the "my lock, just renew" case.
  return acquireSignalLock(signalId);
}

/**
 * Release a signal lock. No-op if the current user doesn't hold it —
 * we don't steal-then-release or error on that case, just return.
 * Best-effort release on tab close or navigation away.
 */
export async function releaseSignalLock(signalId: string): Promise<void> {
  const user = await getCurrentUserWithOrg();
  if (!user) return; // fail-silent on release

  await db
    .delete(signalLocks)
    .where(
      and(
        eq(signalLocks.signalId, signalId),
        eq(signalLocks.lockedBy, user.authId),
      ),
    );
}

/**
 * Read-only lock status check. Doesn't try to acquire. Useful for
 * rendering the read-only banner without mutating state.
 */
export async function getSignalLockStatus(
  signalId: string,
): Promise<LockStatus> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");
  return readLockStatus(signalId, user.authId);
}

// ─── Internal ───────────────────────────────────────────────────────

/** Fetch current lock + holder's email in one go. */
async function readLockStatus(
  signalId: string,
  currentAuthId: string,
): Promise<LockStatus> {
  const [row] = await db
    .select({
      lockedBy: signalLocks.lockedBy,
      expiresAt: signalLocks.expiresAt,
      holderEmail: users.email,
    })
    .from(signalLocks)
    .leftJoin(users, eq(users.id, signalLocks.lockedBy))
    .where(eq(signalLocks.signalId, signalId))
    .limit(1);

  if (!row) {
    return {
      heldByMe: false,
      lockedByAuthId: null,
      lockedByEmail: null,
      expiresAt: null,
    };
  }

  // Check expiry — if expired, treat as not-held (the next acquire
  // will take it over regardless).
  const now = new Date();
  if (new Date(row.expiresAt).getTime() < now.getTime()) {
    return {
      heldByMe: false,
      lockedByAuthId: null,
      lockedByEmail: null,
      expiresAt: null,
    };
  }

  return {
    heldByMe: row.lockedBy === currentAuthId,
    lockedByAuthId: row.lockedBy,
    lockedByEmail: row.holderEmail ?? null,
    expiresAt: row.expiresAt,
  };
}
