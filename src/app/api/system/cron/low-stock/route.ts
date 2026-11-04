/**
 * POST /api/system/cron/low-stock
 *
 * Daily sweeper that emails the owner a digest of products at or below
 * their reorder_threshold. Per-product debouncing — won't re-alert on
 * the same SKU more than once per 24h.
 */

import { NextResponse } from "next/server";
import { db, now } from "@/lib/firestore";
import { authorizeCron } from "@/lib/cron-auth";
import { writeAudit } from "@/lib/audit";
import type { ProductDoc, TenantDoc } from "@/lib/firestore-types";
import { EMAIL_FROM } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEBOUNCE_HOURS = 24;

type AlertItem = {
  ref: FirebaseFirestore.DocumentReference;
  product: ProductDoc;
};

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const cutoff = Date.now() - DEBOUNCE_HOURS * 60 * 60 * 1000;
  const tenantCache = new Map<string, TenantDoc>();
  const itemsByTenant = new Map<string, AlertItem[]>();

  // Pull all active products with a reorder threshold set.
  const snap = await db()
    .collectionGroup("products")
    .where("is_active", "==", true)
    .limit(5000)
    .get();

  for (const doc of snap.docs) {
    const p = doc.data() as ProductDoc;
    if (p.reorder_threshold === null || p.reorder_threshold === undefined) continue;
    if (p.on_hand_quantity > p.reorder_threshold) continue;
    const lastAlert = p.last_low_stock_alert_at?.toDate().getTime() ?? 0;
    if (lastAlert > cutoff) continue;
    const list = itemsByTenant.get(p.tenant_id) ?? [];
    list.push({ ref: doc.ref, product: p });
    itemsByTenant.set(p.tenant_id, list);
  }

  let tenantsAlerted = 0;
  let productsAlerted = 0;

  for (const [tenantId, items] of itemsByTenant) {
    if (items.length === 0) continue;
    let tenant = tenantCache.get(tenantId);
    if (!tenant) {
      const t = await db().collection("tenants").doc(tenantId).get();
      if (!t.exists) continue;
      tenant = t.data() as TenantDoc;
      tenantCache.set(tenantId, tenant);
    }
    try {
      await sendDigestEmail(tenant, items);
      // Mark all as alerted
      const batch = db().batch();
      for (const it of items) {
        batch.update(it.ref, {
          last_low_stock_alert_at: now(),
          updated_at: now(),
        });
      }
      await batch.commit();
      await writeAudit({
        action: "low_stock.alert_sent",
        actorEmail: null,
        targetType: "tenant",
        targetId: tenantId,
        after: { product_count: items.length },
      });
      tenantsAlerted++;
      productsAlerted += items.length;
    } catch (err) {
      console.error("[low-stock] send", err);
    }
  }

  return NextResponse.json({
    ok: true,
    tenants_alerted: tenantsAlerted,
    products_alerted: productsAlerted,
  });
}

async function sendDigestEmail(
  tenant: TenantDoc,
  items: AlertItem[],
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const rows = items
    .map((i) => {
      const p = i.product;
      const onHand = p.on_hand_quantity;
      const reorder = p.reorder_threshold ?? 0;
      const status = onHand <= 0 ? "OUT" : onHand <= reorder / 2 ? "Critical" : "Low";
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${escapeHtml(p.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${onHand <= 0 ? "#b91c1c" : onHand <= reorder / 2 ? "#c2410c" : "#92400e"}">
          ${onHand} / ${reorder}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:11px;color:#888">${escapeHtml(p.unit)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:11px">${status}</td>
      </tr>
    `;
    })
    .join("");

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://aesthera.io";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.default,
      to: [tenant.owner_email],
      subject: `${tenant.name} — ${items.length} product${items.length === 1 ? "" : "s"} below reorder level`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1b2636">
          <h2 style="margin:0 0 8px 0;font-size:18px">Inventory below reorder level</h2>
          <p style="color:#666;margin:0 0 16px 0;font-size:13px">
            ${items.length} item${items.length === 1 ? "" : "s"} at or below reorder threshold. Order now to avoid running out.
          </p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f9f8f5">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Product</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase">On hand / threshold</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Unit</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin:20px 0">
            <a href="${baseUrl}/owner/inventory" style="display:inline-block;padding:10px 20px;background:#1b2636;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
              Review inventory →
            </a>
          </p>
        </div>
      `,
    }),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
