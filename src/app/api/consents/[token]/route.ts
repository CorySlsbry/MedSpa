/**
 * GET /api/consents/[token]
 *
 * Public — token-secured. Returns the consent data needed to render
 * the signing page. Doesn't require auth (the token itself is the
 * authorization). Returns 404 / 410 for missing / expired tokens to
 * avoid token enumeration.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import type { ConsentDoc, TenantDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ token: string }> },
) {
  const { token } = await rctx.params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid link." }, { status: 404 });
  }
  // Cross-tenant collection-group query so the token alone resolves the consent
  const snap = await db()
    .collectionGroup("consents")
    .where("signing_token", "==", token)
    .limit(1)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) {
    return NextResponse.json({ error: "Invalid link." }, { status: 404 });
  }
  const docSnap = snap.docs[0];
  const c = docSnap.data() as ConsentDoc;

  if (c.expires_at instanceof Timestamp && c.expires_at.toDate().getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }
  if (c.status !== "pending") {
    return NextResponse.json(
      { error: c.status === "signed" ? "This consent is already signed." : "Link no longer valid." },
      { status: 410 },
    );
  }

  // Fetch tenant for branding
  const tenantSnap = await db().collection("tenants").doc(c.tenant_id).get();
  const tenant = tenantSnap.exists ? (tenantSnap.data() as TenantDoc) : null;

  return NextResponse.json({
    ok: true,
    consent: {
      id: docSnap.id,
      template_name: c.template_name_snapshot,
      body: c.body_snapshot,
      client_name: c.client_name_snapshot,
      client_email: c.client_email_snapshot,
      expires_at: c.expires_at instanceof Timestamp ? c.expires_at.toDate().toISOString() : null,
    },
    tenant: tenant
      ? {
          name: tenant.name,
          primary_color: tenant.primary_color,
          logo_url: tenant.logo_url,
        }
      : null,
  });
}
