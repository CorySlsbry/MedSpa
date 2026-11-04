/**
 * POST /api/provider/charts/[appointmentId]/ai-draft
 *
 * Generates a SOAP starter draft for the provider via Vertex AI Gemini.
 * Returns the draft as JSON; the client renders it into the editor for
 * the provider to edit + sign.
 *
 * The AI never auto-saves — every draft is reviewed by the provider
 * before signing.
 *
 * Authorization: tenant_provider AND appointment.provider_id == caller UID.
 *
 * Rate limit: per-provider 30/hr (prevents runaway prompt chaining).
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateSoapDraft } from "@/lib/ai";
import { checkMonthlyUsage, bumpMonthlyUsage } from "@/lib/tier-limits";
import type {
  AppointmentDoc,
  ChartDoc,
  ClientDoc,
  ServiceDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 30, windowMs: 60 * 60 * 1000 };

export async function POST(
  req: Request,
  rctx: { params: Promise<{ appointmentId: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_provider");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { appointmentId } = await rctx.params;

  const rl = checkRateLimit(`ai-draft:${ctx.user.firebaseUid}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI drafts in this hour. Try again later." },
      { status: 429 },
    );
  }

  // Tier monthly quota
  const quota = await checkMonthlyUsage({
    tenantId: ctx.tenant.id,
    tier: ctx.tenant.subscription_tier,
    field: "ai_soap_drafts",
  });
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.message, upgrade_to: quota.upgrade_to },
      { status: 402 },
    );
  }

  // Resolve appointment + verify ownership
  const apptSnap = await tenantCol(ctx.tenant.id, "appointments").doc(appointmentId).get();
  if (!apptSnap.exists) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }
  const appt = apptSnap.data() as AppointmentDoc;
  if (appt.provider_id !== ctx.user.firebaseUid) {
    return NextResponse.json({ error: "Not your appointment." }, { status: 403 });
  }

  // Resolve client + service for prompt context
  const [cliSnap, svcQuerySnap] = await Promise.all([
    tenantCol(ctx.tenant.id, "clients").doc(appt.client_id).get(),
    tenantCol(ctx.tenant.id, "services").where("name", "==", appt.service).limit(1).get(),
  ]);
  const cli = cliSnap.exists ? (cliSnap.data() as ClientDoc) : null;
  const svc = !svcQuerySnap.empty ? (svcQuerySnap.docs[0].data() as ServiceDoc) : null;

  // Optional: pull the most recent SIGNED chart for this client for history context
  let priorChart = null;
  try {
    const priorSnap = await tenantCol(ctx.tenant.id, "charts")
      .where("client_id", "==", appt.client_id)
      .where("status", "==", "signed")
      .orderBy("signed_at", "desc")
      .limit(1)
      .get();
    if (!priorSnap.empty) {
      const data = priorSnap.docs[0].data() as ChartDoc;
      priorChart = {
        subjective: data.subjective,
        objective: data.objective,
        assessment: data.assessment,
        plan: data.plan,
        signedAt: toDate(data.signed_at),
      };
    }
  } catch {
    // Composite index may be missing — skip prior chart context, the AI
    // can still produce a useful draft from service + client info alone.
  }

  let draft: Awaited<ReturnType<typeof generateSoapDraft>>;
  try {
    draft = await generateSoapDraft({
      serviceName: appt.service,
      serviceCategory: svc?.category ?? "other",
      serviceDurationMinutes: svc?.duration_minutes ?? 30,
      clientName: cli?.full_name ?? "Client",
      clientTags: cli?.tags ?? [],
      appointmentNotes: appt.notes,
      priorChart,
    });
  } catch (err) {
    console.error("[ai-draft] generation failed", err);
    return NextResponse.json(
      { error: "AI is unavailable right now. Try again or write the chart manually." },
      { status: 502 },
    );
  }

  // Audit (no PHI in the audit body — just metadata)
  try {
    await writeAudit({
      action: "note.create",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "chart.ai_draft",
      targetId: appointmentId,
      after: {
        service: appt.service,
        had_prior_chart: !!priorChart,
        // Store byte counts only — never the draft body in the audit
        bytes: {
          subjective: draft.subjective.length,
          objective: draft.objective.length,
          assessment: draft.assessment.length,
          plan: draft.plan.length,
        },
      },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    });
  } catch (err) {
    console.error("[ai-draft] audit failed", err);
  }

  // Bump monthly usage counter
  void bumpMonthlyUsage({ tenantId: ctx.tenant.id, field: "ai_soap_drafts" }).catch((err) =>
    console.error("[ai-draft] usage bump failed", err),
  );

  // Use Timestamp import to satisfy the type import (it's also used elsewhere
  // in this file's transitive types; keep it warm for the linter)
  void Timestamp;

  return NextResponse.json({ ok: true, draft });
}
