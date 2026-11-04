/**
 * GET  /api/owner/consent-templates  — list templates for this tenant
 * POST /api/owner/consent-templates  — create a new template
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type { ConsentTemplateDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  body: z.string().trim().min(20).max(20000),
  status: z.enum(["draft", "active"]).default("active"),
  kind: z.enum(["consent", "intake"]).default("consent"),
});

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const feat = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "digital_consents" });
  if (!feat.ok) {
    return NextResponse.json({ error: feat.message, upgrade_to: feat.upgrade_to }, { status: 402 });
  }

  const snap = await tenantCol(ctx.tenant.id, "consent_templates")
    .orderBy("created_at", "desc")
    .limit(100)
    .get()
    .catch(() => null);

  const templates =
    snap?.docs.map((d) => {
      const t = d.data() as ConsentTemplateDoc;
      return {
        id: d.id,
        name: t.name,
        description: t.description,
        kind: t.kind ?? "consent",
        body: t.body,
        version: t.version,
        status: t.status,
        created_at: (t.created_at as Timestamp)?.toDate().toISOString() ?? null,
        updated_at: (t.updated_at as Timestamp)?.toDate().toISOString() ?? null,
      };
    }) ?? [];
  return NextResponse.json({ ok: true, templates });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const feat = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "digital_consents" });
  if (!feat.ok) {
    return NextResponse.json({ error: feat.message, upgrade_to: feat.upgrade_to }, { status: 402 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const ref = tenantCol(ctx.tenant.id, "consent_templates").doc();
  const doc: Omit<ConsentTemplateDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    name: data.name,
    description: data.description ?? null,
    kind: data.kind,
    body: data.body,
    version: 1,
    status: data.status,
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "consent_template",
    targetId: ref.id,
    after: { name: data.name, status: data.status, version: 1 },
  }).catch((err) => console.error("[consent-template] audit", err));

  return NextResponse.json({ ok: true, id: ref.id });
}
