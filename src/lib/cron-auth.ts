/**
 * Cloud Scheduler / Cloud Tasks authentication.
 *
 * Cron-style endpoints (/api/system/cron/*) accept ONE of two auth modes:
 *
 *   1. Header `x-aesthera-cron-key` matching CRON_SHARED_SECRET (env).
 *      Simple shared secret. Used by Cloud Scheduler when configured with
 *      a static auth header.
 *
 *   2. Google OIDC ID token in `Authorization: Bearer <token>`. The token
 *      audience must equal the Cloud Run service URL. This is the
 *      Google-recommended pattern for Cloud Scheduler → Cloud Run.
 *
 * For now we implement (1) only — keeps deployment simple. Cory can pick
 * Scheduler with header-based auth and store the shared secret in Secret
 * Manager. (2) is a future hardening upgrade.
 *
 * SECURITY: a missing CRON_SHARED_SECRET makes the endpoint return 503
 * (no auth means no execution — fail closed).
 */

export function authorizeCron(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Cron is not configured.",
    };
  }
  const provided = req.headers.get("x-aesthera-cron-key");
  if (!provided) {
    return { ok: false, status: 401, error: "Missing cron key." };
  }
  // Constant-time-ish comparison
  if (provided.length !== secret.length || provided !== secret) {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  return { ok: true };
}
