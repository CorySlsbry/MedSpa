/**
 * GET  /api/owner/consents?client_id=...  — list consent records
 * POST /api/owner/consents                 — initiate a new signing request
 *
 * Initiating creates a pending ConsentDoc with a public signing token
 * and returns the URL the clinic can text/email to the client. Tokens
 * expire after 30 days.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import { newSigningToken } from "@/lib/consents";
import type { ConsentDoc, ConsentTemplateDoc, ClientDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_DAYS = 30;

const Initiate = z.object({
  template_id: z.string().trim().min(1),
  client_id: z.string().trim().min(1).optional(),
  client_email: z.string().trim().toLowerCase().email().optional(),
  client_name: z.string().trim().min(1).max(200).optional(),
  appointment_id: z.string().trim().min(1).optional(),
}).refine(
  (d) => d.client_id || (d.client_email && d.client_name),
  "Provide either client_id OR (client_email + client_name).",
);

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const feat = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "digital_consents" });
  if (!feat.ok) {
    return NextResponse.json({ error: feat.message, upgrade_to: feat.upgrade_to }, { status: 402 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  let q: FirebaseFirestore.Query = tenantCol(ctx.tenant.id, "consents");
  if (clientId) q = q.where("client_id", "==", clientId);
  const snap = await q.orderBy("created_at", "desc").limit(100).get().catch(() => null);

  const consents =
    snap?.docs.map((d) => {
      const c = d.data() as ConsentDoc;
      return {
        id: d.id,
        template_id: c.template_id,
        template_name: c.template_name_snapshot,
        client_id: c.client_id,
        client_email: c.client_email_snapshot,
        client_name: c.client_name_snapshot,
        status: c.status,
        signing_token: c.status === "pending" ? c.signing_token : null,
        signed_at: c.signed_at instanceof Timestamp ? c.signed_at.toDate().toISOString() : null,
        expires_at: c.expires_at instanceof Timestamp ? c.expires_at.toDate().toISOString() : null,
        has_pdf: !!c.pdf_storage_path,
        signer_typed_name: c.signer_typed_name,
        created_at: (c.created_at as Timestamp)?.toDate().toISOString() ?? null,
      };
    }) ?? [];
  return NextResponse.json({ ok: true, consents });
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
  const parsed = Initiate.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Resolve template
  const tplRef = tenantCol(ctx.tenant.id, "consent_templates").doc(data.template_id);
  const tplSnap = await tplRef.get();
  if (!tplSnap.exists) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  const tpl = tplSnap.data() as ConsentTemplateDoc;
  if (tpl.status === "archived") {
    return NextResponse.json({ error: "Template is archived." }, { status: 409 });
  }

  // Resolve client (if id given) for snapshot fields
  let clientId: string | null = data.client_id ?? null;
  let clientName = data.client_name ?? "";
  let clientEmail = data.client_email ?? "";
  if (clientId) {
    const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(clientId).get();
    if (!cliSnap.exists) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    const cli = cliSnap.data() as ClientDoc;
    clientName = clientName || cli.full_name;
    clientEmail = clientEmail || cli.email;
  }
  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: "Client name + email required." }, { status: 400 });
  }

  const ref = tenantCol(ctx.tenant.id, "consents").doc();
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const token = newSigningToken();
  const doc: Omit<ConsentDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    template_id: data.template_id,
    template_name_snapshot: tpl.name,
    client_id: clientId,
    client_email_snapshot: clientEmail.toLowerCase(),
    client_name_snapshot: clientName,
    appointment_id: data.appointment_id ?? null,
    signing_token: token,
    status: "pending",
    body_snapshot: tpl.body,
    signature_storage_path: null,
    pdf_storage_path: null,
    pdf_byte_size: null,
    signed_at: null,
    signer_typed_name: null,
    signer_ip: null,
    signer_user_agent: null,
    expires_at: Timestamp.fromDate(expires),
    initiated_by_user_id: ctx.user.firebaseUid,
    initiated_by_email: ctx.user.email,
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "consent.initiate",
    targetId: ref.id,
    after: {
      tenant_id: ctx.tenant.id,
      template_id: data.template_id,
      client_email: clientEmail,
      client_id: clientId,
    },
  }).catch((err) => console.error("[consents-initiate] audit", err));

  const origin = `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
  const signingUrl = `${origin}/consent/${token}`;

  return NextResponse.json({
    ok: true,
    consent_id: ref.id,
    signing_token: token,
    signing_url: signingUrl,
    expires_at: expires.toISOString(),
  });
}
