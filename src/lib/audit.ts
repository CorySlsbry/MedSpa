/**
 * Audit logging — writes append-only rows to the `audit_log` Firestore collection.
 *
 * Append-only is enforced by the security rules in firestore/security-rules:
 * the audit_log collection allows `create` from authenticated super-admin
 * users (and from server-side Admin SDK calls), but `update` and `delete`
 * are denied for everyone.
 *
 * Sanitization: never put raw passwords, OAuth tokens, or session cookies
 * into before/after. The scrubber below redacts known-sensitive keys.
 */

import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import type { AuditAction, AuditLogDoc } from "./firestore-types";

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "secret",
  "token",
  "id_token",
  "refresh_token",
  "session",
  "session_cookie",
  "api_key",
  "private_key",
]);

function scrub<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : scrub(v);
  }
  return out as unknown as T;
}

export type AuditWrite = {
  action: AuditAction;
  actorUserId?: string | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

function buildDoc(audit: AuditWrite): Omit<AuditLogDoc, "created_at"> & {
  created_at: ReturnType<typeof now>;
} {
  return {
    actor_user_id: audit.actorUserId ?? null,
    actor_email: audit.actorEmail ?? null,
    action: audit.action,
    target_type: audit.targetType ?? null,
    target_id: audit.targetId ?? null,
    before: audit.before ? scrub(audit.before) : null,
    after: audit.after ? scrub(audit.after) : null,
    ip: audit.ip ?? null,
    user_agent: audit.userAgent ?? null,
    request_id: audit.requestId ?? null,
    created_at: now(),
  };
}

/** Standalone write — for outside-transaction audits (e.g. login attempts). */
export async function writeAudit(audit: AuditWrite): Promise<void> {
  await db().collection("audit_log").add(buildDoc(audit));
}

/** In-transaction write — keeps audit + data write atomic. */
export function writeAuditInTx(trx: Transaction, audit: AuditWrite): void {
  const ref = db().collection("audit_log").doc();
  trx.create(ref, buildDoc(audit));
}

/** For convenience — re-export the timestamp helper used in audit consumers. */
export { Timestamp };
