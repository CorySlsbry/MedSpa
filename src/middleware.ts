/**
 * Edge middleware — runs on every request before route handlers.
 *
 * Responsibilities:
 *   1. Apply security headers to every response (CSP, HSTS, X-Frame-Options,
 *      X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
 *   2. Gate /admin and /api/admin: a session cookie must be present, otherwise
 *      redirect to /admin/login (pages) or 401 (APIs).
 *
 * Important: full session VERIFICATION (calling Firebase Admin SDK to confirm
 * the cookie is valid) cannot run in middleware because firebase-admin
 * requires the Node runtime, not the Edge runtime. Middleware only checks
 * COOKIE PRESENCE here. The (dashboard) layout and /api/admin route handlers
 * do the real verification server-side. Defense-in-depth: two layers.
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "__aesthera_session";

// Paths a logged-out user is allowed to reach under /admin
const ADMIN_PUBLIC_PATHS = new Set<string>(["/admin/login"]);

// API paths that don't require auth even though they live under /api/admin
const ADMIN_API_PUBLIC_PATHS = new Set<string>([
  "/api/admin/auth/start",
  "/api/admin/auth/callback",
  "/api/admin/auth/password",
  "/api/admin/auth/sign-out",
]);

function applySecurityHeaders(res: NextResponse, isAdmin: boolean): NextResponse {
  // HSTS — force HTTPS for 2 years, include subdomains, preload-eligible.
  // Cloud Run already terminates TLS; HSTS prevents downgrade attacks.
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  // Prevent clickjacking. Admin is DENY (no embedding anywhere). Marketing
  // can be embedded in narrow trusted contexts but for now SAMEORIGIN.
  res.headers.set("X-Frame-Options", isAdmin ? "DENY" : "SAMEORIGIN");

  // Prevent MIME-sniffing.
  res.headers.set("X-Content-Type-Options", "nosniff");

  // Limit referrer leakage on cross-origin navigations.
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Lock down powerful APIs we don't use.
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );

  // CSP — start strict-ish for admin, slightly looser for marketing (which
  // currently has inline JSON-LD scripts via dangerouslySetInnerHTML).
  // 'self' covers same-origin assets. 'unsafe-inline' is required for the
  // JSON-LD scripts on the landing page; we use a nonce approach when we
  // get to Phase 2 hardening.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.resend.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);

  return res;
}

// Tenant portal paths require an authenticated tenant user. Cookie presence
// is enforced here; role validation happens server-side in each portal's
// layout.tsx.
const TENANT_PORTAL_PREFIXES = ["/owner", "/manager", "/provider", "/front-desk", "/client"];

function isTenantPortalPath(pathname: string): boolean {
  return TENANT_PORTAL_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isTenantPortal = isTenantPortalPath(pathname);
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // Auth gate — admin pages
  if (isAdminPage && !ADMIN_PUBLIC_PATHS.has(pathname)) {
    if (!sessionCookie) {
      const url = new URL("/admin/login", req.url);
      url.searchParams.set("next", pathname);
      const res = NextResponse.redirect(url);
      return applySecurityHeaders(res, true);
    }
  }

  // Auth gate — admin APIs
  if (isAdminApi && !ADMIN_API_PUBLIC_PATHS.has(pathname)) {
    if (!sessionCookie) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return applySecurityHeaders(res, true);
    }
  }

  // Auth gate — tenant portals (/owner, /provider, /client)
  if (isTenantPortal && !sessionCookie) {
    const url = new URL("/sign-in", req.url);
    const res = NextResponse.redirect(url);
    return applySecurityHeaders(res, true);
  }

  // Forward the resolved pathname so server components / layouts can do
  // path-aware enforcement (e.g. AAL2 gate that excludes /admin/security).
  // Must be set on the REQUEST headers via NextResponse.next({ request }) —
  // setting on res.headers only sends them back to the browser, never to
  // downstream Server Components.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-aesthera-pathname", pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(res, isAdminPage || isAdminApi || isTenantPortal);
}

export const config = {
  // Match every path except Next internals and public asset extensions.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|ttf)).*)",
  ],
};
