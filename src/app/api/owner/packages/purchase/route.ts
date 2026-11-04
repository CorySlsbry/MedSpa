/**
 * POST /api/owner/packages/purchase
 *
 * Sells a package to a client. Three modes:
 *   1. mode="paid": creates a PaymentIntent on the connected account.
 *      Returns client_secret so the front-desk UI confirms the card.
 *      ClientPackageDoc is created immediately with source=paid; source-
 *      of-truth for "did they actually pay" is the PaymentDoc.status.
 *   2. mode="comp": clinic comps the package (no charge). Source=comp.
 *   3. mode="gift": gifted package (no charge). Source=gift.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { createPayment } from "@/lib/payments";
import type {
  ClientDoc,
  ClientPackageDoc,
  ClientPackageSource,
  PackagePlanDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    plan_id: z.string().min(1),
    client_id: z.string().min(1),
    mode: z.enum(["paid", "comp", "gift"]).default("paid"),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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
  const data = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Read plan + client
  const [planSnap, cliSnap] = await Promise.all([
    tenantCol(ctx.tenant.id, "package_plans").doc(data.plan_id).get(),
    tenantCol(ctx.tenant.id, "clients").doc(data.client_id).get(),
  ]);
  if (!planSnap.exists) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }
  if (!cliSnap.exists) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  const plan = planSnap.data() as PackagePlanDoc;
  if (!plan.is_active) {
    return NextResponse.json({ error: "Plan is archived." }, { status: 400 });
  }
  const client = cliSnap.data() as ClientDoc;

  // For paid mode, ensure Connect is active
  if (data.mode === "paid") {
    if (
      !ctx.tenant.stripe_connect_account_id ||
      !ctx.tenant.stripe_connect_charges_enabled
    ) {
      return NextResponse.json(
        { error: "Stripe Connect must be live to take payment." },
        { status: 400 },
      );
    }
  }

  // 1. (paid only) create PaymentIntent
  let paymentDocId: string | null = null;
  let clientSecret: string | null = null;
  if (data.mode === "paid") {
    const pay = await createPayment({
      tenant: ctx.tenant,
      kind: "package",
      amountCents: plan.price_cents,
      clientId: data.client_id,
      receiptEmail: client.email,
      refType: "package_purchase",
      description: `Package · ${plan.name}`,
    });
    paymentDocId = pay.paymentDocId;
    clientSecret = pay.clientSecret;
  }

  // 2. Create ClientPackageDoc
  const expiresAt =
    plan.expires_in_days !== null
      ? new Date(Date.now() + plan.expires_in_days * 24 * 60 * 60 * 1000)
      : null;

  let id = "";
  await db().runTransaction(async (trx) => {
    const ref = tenantCol(ctx.tenant.id, "client_packages").doc();
    id = ref.id;
    const doc: Omit<ClientPackageDoc, "created_at" | "updated_at"> & {
      created_at: ReturnType<typeof now>;
      updated_at: ReturnType<typeof now>;
    } = {
      tenant_id: ctx.tenant.id,
      client_id: data.client_id,
      plan_id: data.plan_id,
      plan_name_snapshot: plan.name,
      service_name_snapshot: plan.service_name,
      sessions_total: plan.sessions_total,
      sessions_remaining: plan.sessions_total,
      price_cents_snapshot: plan.price_cents,
      source: data.mode as ClientPackageSource,
      expires_at: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      payment_id: paymentDocId,
      created_at: now(),
      updated_at: now(),
    };
    trx.create(ref, doc);
    writeAuditInTx(trx, {
      action: "package.purchase",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "client_package",
      targetId: id,
      after: {
        plan_id: data.plan_id,
        plan_name: plan.name,
        client_id: data.client_id,
        mode: data.mode,
        sessions: plan.sessions_total,
        price_cents: plan.price_cents,
        note: data.note ?? null,
      },
      ip,
      userAgent: ua,
    });
  });

  return NextResponse.json({
    ok: true,
    client_package_id: id,
    client_secret: clientSecret,
    payment_id: paymentDocId,
    sessions_total: plan.sessions_total,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    publishable_key: clientSecret ? process.env.STRIPE_PUBLISHABLE_KEY ?? null : null,
    stripe_account_id: clientSecret ? ctx.tenant.stripe_connect_account_id : null,
  });
}
