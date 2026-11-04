/**
 * POST /api/tenant/assistant
 *
 * Conversational AI for tenant users. The role (owner / manager / provider
 * / front_desk) comes from the authenticated session — same endpoint, four
 * different prompts + tool whitelists. See src/lib/owner-assistant.ts for
 * the role-aware turn runner.
 *
 * Available on every subscription tier — usage is metered against the
 * existing `ai_concierge_turns` quota (basic 500/mo, growth 5000/mo,
 * enterprise + founding-25 unlimited). When the quota is hit the user
 * gets a friendly explanation, not a 500.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { checkMonthlyUsage, bumpMonthlyUsage } from "@/lib/tier-limits";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  runAssistantTurn,
  type AssistantMessage,
  type AssistantRole,
} from "@/lib/owner-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20000),
      }),
    )
    .max(20)
    .default([]),
});

const RATE = { capacity: 30, windowMs: 60_000 };

const ALLOWED_ROLES: AssistantRole[] = [
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
];

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Reject roles that don't get an assistant (tenant_client + super_admin
  // don't pass through here in normal flow, but defense-in-depth).
  if (!ALLOWED_ROLES.includes(ctx.user.role as AssistantRole)) {
    return NextResponse.json(
      { error: "The AI assistant isn't available for your account type." },
      { status: 403 },
    );
  }
  const role = ctx.user.role as AssistantRole;

  const rl = checkRateLimit(`tenant-assistant:${ctx.user.firebaseUid}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "You're sending messages faster than we can answer them. Wait a few seconds and try again.",
      },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const quota = await checkMonthlyUsage({
    tenantId: ctx.user.tenantId!,
    tier: ctx.tenant.subscription_tier,
    field: "ai_concierge_turns",
  });
  if (!quota.ok) {
    return NextResponse.json(
      {
        error: "quota_exceeded",
        message: quota.message,
        limit: quota.limit,
        current: quota.current,
        upgrade_to: quota.upgrade_to,
      },
      { status: 429 },
    );
  }

  try {
    const turn = await runAssistantTurn({
      tenantId: ctx.user.tenantId!,
      role,
      tenantName: ctx.tenant.name,
      history: parsed.data.history as AssistantMessage[],
      userMessage: parsed.data.message,
    });

    void bumpMonthlyUsage({
      tenantId: ctx.user.tenantId!,
      field: "ai_concierge_turns",
    }).catch((err) => console.error("[tenant-assistant] usage bump failed", err));

    return NextResponse.json({
      ok: true,
      role,
      reply: turn.reply,
      tool_calls: turn.tool_calls,
    });
  } catch (err) {
    console.error("[tenant-assistant] turn failed", err);
    return NextResponse.json(
      {
        error:
          "The assistant ran into an issue. Try rephrasing your question, or refresh the page if this keeps happening.",
      },
      { status: 500 },
    );
  }
}
