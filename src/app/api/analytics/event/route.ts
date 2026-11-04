/**
 * POST /api/analytics/event — public ingest for marketing analytics.
 *
 * No auth (the marketing site is public). Rate-limited per IP to keep the
 * ingest path cheap and abuse-resistant. Events go to the `analytics_events`
 * Firestore collection — small docs, indexed by `created_at` and `type`.
 *
 * Schema:
 *   {
 *     type: "view" | "scroll_25" | "scroll_50" | "scroll_75" | "scroll_100" | "click" | "signup",
 *     label?: string,        // CTA label or interest tier (≤80 chars)
 *     path: string,          // marketing route (≤200 chars)
 *     session_id: string,    // anonymous, generated client-side
 *     ref?: string,          // document.referrer (≤300 chars)
 *     ip: string | null,     // hashed before write — privacy
 *     user_agent: string,    // truncated to 200 chars
 *     created_at: Timestamp,
 *   }
 *
 * IP is HASHED via SHA-256(salt + ip) before write so we never store raw IPs
 * but can still dedupe / count unique IPs aggregately.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, now } from "@/lib/firestore";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = [
  "view",
  "scroll_25",
  "scroll_50",
  "scroll_75",
  "scroll_100",
  "click",
  "signup",
] as const;

const Body = z.object({
  type: z.enum(ALLOWED_TYPES),
  label: z.string().trim().max(80).nullish(),
  path: z.string().trim().max(200).default("/"),
  session_id: z.string().trim().min(8).max(80),
  ref: z.string().trim().max(300).nullish(),
  ts: z.number().int().nullish(),
});

const RATE = { capacity: 60, windowMs: 60 * 1000 };

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.ANALYTICS_IP_SALT || "aesthera-analytics-default-salt";
  return createHash("sha256").update(salt + ip).digest("hex").slice(0, 24);
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const rl = checkRateLimit(`analytics:${ip}`, RATE);
    if (!rl.allowed) return NextResponse.json({ ok: true, throttled: true });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }
  const data = parsed.data;
  const ua = (req.headers.get("user-agent") || "").slice(0, 200);

  try {
    await db().collection("analytics_events").add({
      type: data.type,
      label: data.label ?? null,
      path: data.path,
      session_id: data.session_id,
      ref: data.ref ?? null,
      ip_hash: hashIp(ip),
      user_agent: ua,
      created_at: now(),
    });
  } catch (err) {
    console.error("[analytics] write failed", err);
    // Always 200 so the client doesn't retry forever — analytics is best-effort.
  }
  return NextResponse.json({ ok: true });
}
