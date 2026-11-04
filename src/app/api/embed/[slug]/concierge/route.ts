/**
 * POST /api/embed/[slug]/concierge
 *
 * Public AI booking concierge. Conversational assistant that helps a
 * prospective client pick a service from the clinic's catalog. Returns
 * a structured reply with optional service recommendation.
 *
 * Public-by-design (no auth) — same posture as the rest of the embed
 * surface. Aggressively rate-limited because each request hits Vertex AI.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenant, tenantCol } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateConciergeReply, type ConciergeMessage } from "@/lib/ai";
import { checkMonthlyUsage, bumpMonthlyUsage } from "@/lib/tier-limits";
import type { ServiceDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

const PER_IP = { capacity: 30, windowMs: 60 * 60 * 1000 };
const PER_TENANT = { capacity: 200, windowMs: 60 * 60 * 1000 };

export async function POST(
  req: Request,
  rctx: { params: Promise<{ slug: string }> },
) {
  const ip = getIp(req);
  const { slug } = await rctx.params;

  if (ip) {
    const rl = checkRateLimit(`embed-concierge:ip:${ip}`, PER_IP);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Slow down — too many concierge requests." },
        { status: 429, headers: corsHeaders() },
      );
    }
  }
  const rlTenant = checkRateLimit(`embed-concierge:tenant:${slug}`, PER_TENANT);
  if (!rlTenant.allowed) {
    return NextResponse.json(
      { error: "The concierge is busy — please try again in a moment." },
      { status: 429, headers: corsHeaders() },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: corsHeaders() });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400, headers: corsHeaders() },
    );
  }

  const tenant = await getTenant(slug);
  if (!tenant || tenant.subscription_status === "cancelled") {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: corsHeaders() });
  }

  // Tier quota
  const quota = await checkMonthlyUsage({
    tenantId: slug,
    tier: tenant.subscription_tier,
    field: "ai_concierge_turns",
  });
  if (!quota.ok) {
    return NextResponse.json(
      {
        error:
          "The concierge has hit this clinic's monthly quota. Browse services manually or check back next month.",
      },
      { status: 503, headers: corsHeaders() },
    );
  }

  const svcSnap = await tenantCol(slug, "services")
    .where("is_active", "==", true)
    .orderBy("name", "asc")
    .limit(100)
    .get();
  if (svcSnap.empty) {
    return NextResponse.json(
      {
        ok: true,
        assistant_message:
          "We don't have a published service catalog yet — the clinic will be in touch directly to help you book.",
        recommended_service_id: null,
        ask_followup: null,
      },
      { status: 200, headers: corsHeaders() },
    );
  }

  const catalog = svcSnap.docs.map((d) => {
    const s = d.data() as ServiceDoc;
    return {
      id: d.id,
      name: s.name,
      category: s.category,
      duration_minutes: s.duration_minutes,
      description: s.description,
      price_cents: s.price_cents,
    };
  });

  const messages: ConciergeMessage[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let reply;
  try {
    reply = await generateConciergeReply({
      tenantName: tenant.name,
      catalog,
      messages,
    });
  } catch (err) {
    console.error("[concierge] AI failure", err);
    return NextResponse.json(
      {
        error:
          "The concierge is unavailable right now. You can keep browsing services manually.",
      },
      { status: 503, headers: corsHeaders() },
    );
  }

  // Bump usage counter (success only)
  void bumpMonthlyUsage({ tenantId: slug, field: "ai_concierge_turns" }).catch((err) =>
    console.error("[concierge] usage bump failed", err),
  );

  return new NextResponse(
    JSON.stringify({
      ok: true,
      ...reply,
    }),
    { status: 200, headers: corsHeaders() },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
