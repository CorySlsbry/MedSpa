/**
 * GET /api/public/gift-cards/[code]?slug=clinic-slug
 *
 * Anonymous: holders look up the balance + tenant info to confirm it's
 * legitimate. Rate-limited; returns minimal info — no PII beyond what
 * the holder already has.
 */

import { NextResponse } from "next/server";
import { tenantCol, getTenant } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { toDate } from "@/lib/firestore";
import type { GiftCardDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 30, windowMs: 60 * 60 * 1000 };

export async function GET(
  req: Request,
  rctx: { params: Promise<{ code: string }> },
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) {
    const rl = checkRateLimit(`gc-lookup:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many lookups." }, { status: 429 });
    }
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Tenant slug required." }, { status: 400 });
  }

  const tenant = await getTenant(slug);
  if (!tenant) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  const { code } = await rctx.params;
  const normalized = code.toUpperCase();
  const snap = await tenantCol(slug, "gift_cards").doc(normalized).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }
  const card = snap.data() as GiftCardDoc;
  return NextResponse.json({
    ok: true,
    code: snap.id,
    balance_cents: card.balance_cents,
    original_amount_cents: card.original_amount_cents,
    expires_at: toDate(card.expires_at),
    tenant_name: tenant.name,
    is_expired: card.expires_at ? card.expires_at.toDate().getTime() < Date.now() : false,
    is_fully_redeemed: card.balance_cents <= 0,
  });
}
