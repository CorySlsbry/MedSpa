/**
 * POST /api/consents/[token]/sign
 *
 * Public — token-secured. Captures the signature, renders the PDF,
 * stores both in Cloud Storage, and finalizes the ConsentDoc.
 *
 * Body: { signer_name, signer_email, signature_data_url }
 *   signature_data_url is "data:image/png;base64,..." from the client-side
 *   <canvas> signature pad.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildPdfPath,
  buildSignaturePath,
  pngFromDataUrl,
  renderConsentPdf,
  uploadBytesToBucket,
} from "@/lib/consents";
import type { ConsentDoc, TenantDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 5, windowMs: 60 * 1000 };

const Body = z.object({
  signer_name: z.string().trim().min(2).max(200),
  signer_email: z.string().trim().toLowerCase().email().max(320),
  signature_data_url: z.string().min(50).max(2_000_000),
});

export async function POST(
  req: Request,
  rctx: { params: Promise<{ token: string }> },
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  if (ip) {
    const rl = checkRateLimit(`consent-sign:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many sign attempts. Slow down." }, { status: 429 });
    }
  }

  const { token } = await rctx.params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid link." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const querySnap = await db()
    .collectionGroup("consents")
    .where("signing_token", "==", token)
    .limit(1)
    .get()
    .catch(() => null);
  if (!querySnap || querySnap.empty) {
    return NextResponse.json({ error: "Invalid link." }, { status: 404 });
  }
  const docRef = querySnap.docs[0].ref;
  const c = querySnap.docs[0].data() as ConsentDoc;
  if (c.expires_at instanceof Timestamp && c.expires_at.toDate().getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }
  if (c.status !== "pending") {
    return NextResponse.json({ error: "Link no longer valid." }, { status: 410 });
  }

  // Decode + upload signature
  let signaturePng: Buffer;
  try {
    signaturePng = pngFromDataUrl(parsed.data.signature_data_url);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const consentId = querySnap.docs[0].id;
  const sigPath = buildSignaturePath({ tenantId: c.tenant_id, consentId });
  const pdfPath = buildPdfPath({ tenantId: c.tenant_id, consentId });

  await uploadBytesToBucket(sigPath, signaturePng, "image/png");

  // Render PDF
  const tenantSnap = await db().collection("tenants").doc(c.tenant_id).get();
  const tenant = tenantSnap.exists ? (tenantSnap.data() as TenantDoc) : null;
  const signedAtIso = new Date().toISOString();
  const pdfBytes = await renderConsentPdf({
    tenantName: tenant?.name ?? "Aesthera",
    templateName: c.template_name_snapshot,
    body: c.body_snapshot,
    signerName: parsed.data.signer_name,
    signerEmail: parsed.data.signer_email,
    signerIp: ip,
    signerUserAgent: ua,
    signedAtIso,
    signaturePng,
  });
  await uploadBytesToBucket(pdfPath, pdfBytes, "application/pdf");

  // Finalize doc
  await docRef.update({
    status: "signed",
    signature_storage_path: sigPath,
    pdf_storage_path: pdfPath,
    pdf_byte_size: pdfBytes.length,
    signed_at: now(),
    signer_typed_name: parsed.data.signer_name,
    signer_ip: ip,
    signer_user_agent: ua,
    updated_at: now(),
  });

  // If linked to a client, update HIPAA consent timestamp on the client
  if (c.client_id) {
    await db()
      .collection(`tenants/${c.tenant_id}/clients`)
      .doc(c.client_id)
      .update({ hipaa_consent_signed_at: now(), updated_at: now() })
      .catch(() => undefined);
  }

  await writeAudit({
    action: "admin.user_create",
    actorEmail: parsed.data.signer_email,
    targetType: "consent.signed",
    targetId: consentId,
    after: {
      tenant_id: c.tenant_id,
      template_id: c.template_id,
      template_name: c.template_name_snapshot,
      pdf_bytes: pdfBytes.length,
    },
    ip,
    userAgent: ua,
  }).catch((err) => console.error("[consent-sign] audit", err));

  return NextResponse.json({ ok: true });
}
