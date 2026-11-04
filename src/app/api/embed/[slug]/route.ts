/**
 * GET /api/embed/[slug]
 *
 * Public tenant info for the embed booking widget. Returns ONLY what's
 * needed to render the booking UI — name, branding, timezone. No PHI,
 * no user lists, no internal IDs beyond what's already in the URL.
 *
 * No auth required. Rate-limited per IP.
 */

import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 60, windowMs: 60 * 60 * 1000 };

export async function GET(
  req: Request,
  rctx: { params: Promise<{ slug: string }> },
) {
  const ip = getIp(req);
  if (ip) {
    const rl = checkRateLimit(`embed-tenant:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429 },
      );
    }
  }

  const { slug } = await rctx.params;
  const tenant = await getTenant(slug);
  if (!tenant) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (tenant.subscription_status === "cancelled") {
    return NextResponse.json({ error: "Booking unavailable." }, { status: 403 });
  }

  // CORS: this endpoint is intentionally public + cross-origin so clinics
  // can call it from their own domains. We allow any origin for read-only
  // public data; mutations have their own CORS posture.
  return new NextResponse(
    JSON.stringify({
      ok: true,
      tenant: {
        slug: tenant.id,
        name: tenant.name,
        type: tenant.type,
        timezone: tenant.timezone,
        primary_color: tenant.primary_color,
        logo_url: tenant.logo_url,
      },
    }),
    {
      status: 200,
      headers: corsHeaders(),
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60",
  };
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
