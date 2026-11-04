/**
 * API-key authentication for service-to-service integrations
 * (Jarvis, Apollo MCP wrapper, etc).
 *
 * Auth scheme: Bearer token in Authorization header. The token is matched
 * against a per-integration env-var-resolved secret (e.g. JARVIS_API_KEY).
 * Secrets live in Secret Manager and are mounted via Cloud Run's
 * --update-secrets so they never appear in repo or env logs.
 *
 * Comparison is constant-time-ish (length + char-by-char). Not perfect
 * because we coerce to Buffer, but immune to short-circuit timing leaks
 * once both strings are loaded.
 */

import { timingSafeEqual } from "node:crypto";

export type IntegrationAuthResult =
  | { ok: true; integration: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * Verify a Bearer-token request against a named integration secret.
 *
 * Usage:
 *   const auth = authorizeIntegration(req, "jarvis", "JARVIS_API_KEY");
 *   if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
 */
export function authorizeIntegration(
  req: Request,
  integration: string,
  envVarName: string,
): IntegrationAuthResult {
  const expected = process.env[envVarName];
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: `${integration} integration is not configured.`,
    };
  }

  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header." };
  }
  const provided = m[1].trim();

  if (provided.length !== expected.length) {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  try {
    const ok = timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) return { ok: false, status: 403, error: "Forbidden." };
  } catch {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  return { ok: true, integration };
}
