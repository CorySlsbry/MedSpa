/**
 * GET   /api/provider/charts/[appointmentId]   — fetch (or null if absent)
 * PATCH /api/provider/charts/[appointmentId]   — save draft (or sign)
 *
 * The appointmentId IS the chart doc ID. One chart per appointment.
 *
 * Authorization: caller must be tenant_provider AND the appointment's
 * provider_id must match their UID. Owners can read all charts via a
 * future /api/owner/charts endpoint (not built yet).
 *
 * Once status='signed', further writes return 409. To amend, a new chart
 * with amends_chart_id pointing at this one would be created (Phase 3+).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type {
  AppointmentDoc,
  ChartDoc,
  ChartStatus,
  ProductDoc,
  ProductMovementDoc,
  ProviderDoc,
  ServiceDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  subjective: z.string().max(20_000).optional().nullable(),
  objective: z.string().max(20_000).optional().nullable(),
  assessment: z.string().max(20_000).optional().nullable(),
  plan: z.string().max(20_000).optional().nullable(),
  // The action — 'save_draft' or 'sign'
  action: z.enum(["save_draft", "sign"]).default("save_draft"),
});

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ appointmentId: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_provider");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { appointmentId } = await rctx.params;

  // Verify appointment exists and is theirs
  const apptSnap = await tenantCol(ctx.tenant.id, "appointments").doc(appointmentId).get();
  if (!apptSnap.exists) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }
  const appt = apptSnap.data() as AppointmentDoc;
  if (appt.provider_id !== ctx.user.firebaseUid) {
    return NextResponse.json({ error: "Not your appointment." }, { status: 403 });
  }

  const chartSnap = await tenantCol(ctx.tenant.id, "charts").doc(appointmentId).get();
  if (!chartSnap.exists) {
    return NextResponse.json({ ok: true, chart: null });
  }
  const data = chartSnap.data() as ChartDoc;
  return NextResponse.json({
    ok: true,
    chart: {
      id: chartSnap.id,
      subjective: data.subjective,
      objective: data.objective,
      assessment: data.assessment,
      plan: data.plan,
      status: data.status,
      signedAt: toDate(data.signed_at),
      signedByFullName: data.signed_by_full_name,
      updatedAt: toDate(data.updated_at),
    },
  });
}

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ appointmentId: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_provider");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { appointmentId } = await rctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Patch.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { action, ...soap } = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const result = await db().runTransaction(async (trx) => {
      const apptRef = tenantCol(ctx.tenant.id, "appointments").doc(appointmentId);
      const apptSnap = await trx.get(apptRef);
      if (!apptSnap.exists) throw new Error("Appointment not found.");
      const appt = apptSnap.data() as AppointmentDoc;
      if (appt.provider_id !== ctx.user.firebaseUid) {
        throw new Error("Not your appointment.");
      }

      // Provider doc for the signed_by_full_name snapshot
      const provRef = tenantCol(ctx.tenant.id, "providers").doc(ctx.user.firebaseUid);
      const provSnap = await trx.get(provRef);
      const prov = provSnap.exists ? (provSnap.data() as ProviderDoc) : null;
      const providerName = prov?.full_name ?? ctx.user.email;

      const chartRef = tenantCol(ctx.tenant.id, "charts").doc(appointmentId);
      const chartSnap = await trx.get(chartRef);

      // ─── Inventory deduction (only on transition-to-signed) ───────────────
      // If we're about to sign and the service has products consumed,
      // pre-read the products + service so all reads happen before writes.
      // We never block signing on inventory state — negative on_hand is
      // allowed and surfaces as an audit/correction signal.
      const willSign =
        action === "sign" &&
        (!chartSnap.exists ||
          (chartSnap.data() as ChartDoc).status !== "signed");
      type DeductionPlan = {
        productRef: FirebaseFirestore.DocumentReference;
        product: ProductDoc;
        productId: string;
        qty: number;
        balanceAfter: number;
      };
      const deductions: DeductionPlan[] = [];
      if (willSign) {
        // Look up the service by name (services are tenant-unique by name in
        // the catalog flow; if not found, skip deduction silently).
        // Concurrency: two providers signing charts that consume the same
        // product run as separate transactions. The trx.update on
        // productRef below makes Firestore optimistic concurrency abort
        // and retry one of them, so balance_after is computed correctly.
        // Do NOT remove the trx.update on the no-change path — it's the
        // serialization point.
        const svcQuery = await trx.get(
          tenantCol(ctx.tenant.id, "services")
            .where("name", "==", appt.service)
            .limit(1),
        );
        const svc = !svcQuery.empty
          ? (svcQuery.docs[0].data() as ServiceDoc)
          : null;
        const consumes = svc?.consumes ?? [];
        for (const c of consumes) {
          const productRef = tenantCol(ctx.tenant.id, "products").doc(c.product_id);
          const productSnap = await trx.get(productRef);
          if (!productSnap.exists) continue; // product was deleted; skip
          const product = productSnap.data() as ProductDoc;
          deductions.push({
            productRef,
            product,
            productId: c.product_id,
            qty: c.qty,
            balanceAfter: product.on_hand_quantity - c.qty,
          });
        }
      }

      if (chartSnap.exists) {
        const existing = chartSnap.data() as ChartDoc;
        if (existing.status === "signed") {
          throw new Error("Chart is signed. Amendments require a new chart entry.");
        }
        const updates: Record<string, unknown> = {
          ...soap,
          updated_at: now(),
        };
        if (action === "sign") {
          updates.status = "signed" satisfies ChartStatus;
          updates.signed_at = now();
          updates.signed_by_user_id = ctx.user.firebaseUid;
          updates.signed_by_full_name = providerName;
          // Link the appointment to the chart (idempotent)
          trx.update(apptRef, { chart_id: chartRef.id, updated_at: now() });
        }
        trx.update(chartRef, updates);
        writeAuditInTx(trx, {
          action: action === "sign" ? "chart.sign" : "chart.draft_save",
          actorEmail: ctx.user.email,
          actorUserId: ctx.user.firebaseUid,
          targetType: "chart",
          targetId: chartRef.id,
          before: { status: existing.status },
          after: { status: action === "sign" ? "signed" : existing.status },
          ip,
          userAgent: ua,
        });
        if (willSign) {
          for (const d of deductions) {
            const movementRef = d.productRef.collection("movements").doc();
            const movementDoc: Omit<ProductMovementDoc, "created_at"> & {
              created_at: ReturnType<typeof now>;
            } = {
              tenant_id: ctx.tenant.id,
              product_id: d.productId,
              type: "used",
              delta: -d.qty,
              balance_after: d.balanceAfter,
              reason: `Auto-deducted on chart sign (${appt.service})`,
              ref_type: "chart",
              ref_id: chartRef.id,
              actor_user_id: ctx.user.firebaseUid,
              actor_email: ctx.user.email,
              created_at: now(),
            };
            trx.create(movementRef, movementDoc);
            trx.update(d.productRef, {
              on_hand_quantity: d.balanceAfter,
              updated_at: now(),
            });
          }
        }
        return { signed: action === "sign", created: false, deductions: deductions.length };
      }

      // Create new chart
      const newDoc: Omit<ChartDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        appointment_id: appointmentId,
        client_id: appt.client_id,
        provider_id: ctx.user.firebaseUid,
        subjective: soap.subjective ?? null,
        objective: soap.objective ?? null,
        assessment: soap.assessment ?? null,
        plan: soap.plan ?? null,
        status: action === "sign" ? "signed" : "draft",
        signed_at:
          action === "sign" ? (now() as unknown as Timestamp) : null,
        signed_by_user_id: action === "sign" ? ctx.user.firebaseUid : null,
        signed_by_full_name: action === "sign" ? providerName : null,
        amends_chart_id: null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(chartRef, newDoc);
      if (action === "sign") {
        trx.update(apptRef, { chart_id: chartRef.id, updated_at: now() });
      }
      writeAuditInTx(trx, {
        action: action === "sign" ? "chart.sign" : "chart.draft_save",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "chart",
        targetId: chartRef.id,
        after: { appointment_id: appointmentId, status: newDoc.status },
        ip,
        userAgent: ua,
      });
      if (willSign) {
        for (const d of deductions) {
          const movementRef = d.productRef.collection("movements").doc();
          const movementDoc: Omit<ProductMovementDoc, "created_at"> & {
            created_at: ReturnType<typeof now>;
          } = {
            tenant_id: ctx.tenant.id,
            product_id: d.productId,
            type: "used",
            delta: -d.qty,
            balance_after: d.balanceAfter,
            reason: `Auto-deducted on chart sign (${appt.service})`,
            ref_type: "chart",
            ref_id: chartRef.id,
            actor_user_id: ctx.user.firebaseUid,
            actor_email: ctx.user.email,
            created_at: now(),
          };
          trx.create(movementRef, movementDoc);
          trx.update(d.productRef, {
            on_hand_quantity: d.balanceAfter,
            updated_at: now(),
          });
        }
      }
      return { signed: action === "sign", created: true, deductions: deductions.length };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg.includes("not found")) status = 404;
    else if (msg.includes("Not your appointment")) status = 403;
    else if (msg.includes("signed")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
