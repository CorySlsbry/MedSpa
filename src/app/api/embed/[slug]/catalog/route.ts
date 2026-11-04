/**
 * GET /api/embed/[slug]/catalog
 *
 * Public catalog: active services + locations. Public-safe — no PHI, no
 * provider personal info beyond display name + scheduling color.
 */

import { NextResponse } from "next/server";
import { getTenant, tenantCol } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LocationDoc, ServiceDoc, ProviderDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 60, windowMs: 60 * 60 * 1000 };

export async function GET(
  req: Request,
  rctx: { params: Promise<{ slug: string }> },
) {
  const ip = getIp(req);
  if (ip) {
    const rl = checkRateLimit(`embed-catalog:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
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

  const [locSnap, svcSnap, provSnap] = await Promise.all([
    tenantCol(slug, "locations").where("is_active", "==", true).orderBy("created_at", "asc").limit(50).get(),
    tenantCol(slug, "services").where("is_active", "==", true).orderBy("name", "asc").limit(200).get(),
    tenantCol(slug, "providers").where("is_active", "==", true).orderBy("full_name", "asc").limit(100).get(),
  ]);

  const locations = locSnap.docs.map((d) => {
    const data = d.data() as LocationDoc;
    return {
      id: d.id,
      name: data.name,
      address_line_1: data.address_line_1,
      city: data.city,
      state: data.state,
      timezone: data.timezone,
      is_primary: data.is_primary,
    };
  });
  const services = svcSnap.docs.map((d) => {
    const data = d.data() as ServiceDoc;
    return {
      id: d.id,
      name: data.name,
      category: data.category,
      duration_minutes: data.duration_minutes,
      price_cents: data.price_cents,
      description: data.description,
      deposit_cents: data.deposit_cents ?? null,
    };
  });
  const providers = provSnap.docs.map((d) => {
    const data = d.data() as ProviderDoc;
    return {
      id: d.id,
      full_name: data.full_name,
      title: data.title,
      scheduling_color: data.scheduling_color,
      default_location_id: data.default_location_id,
    };
  });

  return new NextResponse(
    JSON.stringify({ ok: true, locations, services, providers }),
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
    "Cache-Control": "public, max-age=30",
  };
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
