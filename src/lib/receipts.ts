/**
 * Receipt + invoice PDF generation. Uses pdf-lib (already a dep from
 * Phase 5.11 consents) — zero new deps.
 *
 * Receipts are immutable artifacts. Once a payment succeeds, we render
 * a PDF, upload it to Cloud Storage at:
 *   tenants/{slug}/receipts/{paymentId}.pdf
 * and email a signed-URL link to the client.
 *
 * The receipt is the legal record for HSA/FSA reimbursement, so it
 * must include: tenant info, client name, line items, totals,
 * payment method (last 4), and date.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { bucket, signedReadUrl } from "./storage";
import type { PaymentDoc, TenantDoc } from "./firestore-types";

export type ReceiptArgs = {
  tenant: TenantDoc & { id: string };
  payment: PaymentDoc & { id: string };
  clientName: string | null;
  clientEmail: string | null;
  /** Optional human-readable line items. If omitted, falls back to payment.description. */
  lines?: { label: string; amount_cents: number }[];
};

const NAVY = rgb(0.106, 0.149, 0.212);
const GOLD = rgb(0.726, 0.561, 0.259);
const INK = rgb(0.18, 0.2, 0.24);
const MUTED = rgb(0.4, 0.42, 0.48);
const LINE = rgb(0.85, 0.86, 0.89);

function fmt(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function buildPdfPath(tenantId: string, paymentId: string): string {
  return `tenants/${tenantId}/receipts/${paymentId}.pdf`;
}

export async function renderReceiptPdf(args: ReceiptArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width } = page.getSize();
  const margin = 50;
  let y = 740;

  // Brand bar (gold)
  page.drawRectangle({ x: 0, y: 770, width, height: 22, color: GOLD });
  page.drawText(args.tenant.name, {
    x: margin,
    y: 776,
    size: 11,
    font: helvBold,
    color: rgb(1, 1, 1),
  });

  // Receipt heading
  page.drawText("RECEIPT", {
    x: margin,
    y,
    size: 22,
    font: helvBold,
    color: NAVY,
  });
  y -= 6;
  page.drawText(`#${args.payment.id.slice(0, 12).toUpperCase()}`, {
    x: margin,
    y: y - 14,
    size: 10,
    font: helv,
    color: MUTED,
  });
  y -= 38;

  // Tenant + client block
  page.drawText("From", {
    x: margin,
    y,
    size: 8,
    font: helvBold,
    color: MUTED,
  });
  page.drawText("Bill to", {
    x: 320,
    y,
    size: 8,
    font: helvBold,
    color: MUTED,
  });
  y -= 14;
  page.drawText(args.tenant.name, { x: margin, y, size: 11, font: helvBold, color: INK });
  page.drawText(args.clientName ?? args.clientEmail ?? "Client", {
    x: 320,
    y,
    size: 11,
    font: helvBold,
    color: INK,
  });
  y -= 14;
  page.drawText(args.tenant.owner_email, { x: margin, y, size: 9, font: helv, color: MUTED });
  if (args.clientEmail) {
    page.drawText(args.clientEmail, { x: 320, y, size: 9, font: helv, color: MUTED });
  }
  y -= 30;

  // Date / payment-method block
  const chargedAt = args.payment.charged_at.toDate();
  page.drawText("Date", { x: margin, y, size: 8, font: helvBold, color: MUTED });
  page.drawText(
    chargedAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    { x: margin, y: y - 14, size: 11, font: helv, color: INK },
  );
  page.drawText("Payment method", {
    x: 320,
    y,
    size: 8,
    font: helvBold,
    color: MUTED,
  });
  const cardLine = args.payment.card_brand
    ? `${args.payment.card_brand.toUpperCase()} •••• ${args.payment.card_last4 ?? ""}`
    : "Card on file";
  page.drawText(cardLine, { x: 320, y: y - 14, size: 11, font: helv, color: INK });
  y -= 40;

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: LINE,
  });
  y -= 22;

  // Line items
  page.drawText("Description", {
    x: margin,
    y,
    size: 8,
    font: helvBold,
    color: MUTED,
  });
  page.drawText("Amount", {
    x: width - margin - 70,
    y,
    size: 8,
    font: helvBold,
    color: MUTED,
  });
  y -= 18;

  const lines: { label: string; amount_cents: number }[] = args.lines ?? [
    {
      label: args.payment.description ?? humanKind(args.payment.kind),
      amount_cents:
        args.payment.amount_cents - args.payment.tip_cents - args.payment.tax_cents,
    },
  ];
  for (const line of lines) {
    page.drawText(line.label, { x: margin, y, size: 11, font: helv, color: INK });
    page.drawText(fmt(line.amount_cents, args.payment.currency.toUpperCase()), {
      x: width - margin - 70,
      y,
      size: 11,
      font: helv,
      color: INK,
    });
    y -= 18;
  }

  if (args.payment.tax_cents > 0) {
    page.drawText("Tax", { x: margin, y, size: 11, font: helv, color: MUTED });
    page.drawText(fmt(args.payment.tax_cents, args.payment.currency.toUpperCase()), {
      x: width - margin - 70,
      y,
      size: 11,
      font: helv,
      color: MUTED,
    });
    y -= 18;
  }
  if (args.payment.tip_cents > 0) {
    page.drawText("Tip", { x: margin, y, size: 11, font: helv, color: MUTED });
    page.drawText(fmt(args.payment.tip_cents, args.payment.currency.toUpperCase()), {
      x: width - margin - 70,
      y,
      size: 11,
      font: helv,
      color: MUTED,
    });
    y -= 18;
  }

  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: LINE,
  });
  y -= 22;

  // Total
  page.drawText("TOTAL", { x: margin, y, size: 11, font: helvBold, color: NAVY });
  page.drawText(fmt(args.payment.amount_cents, args.payment.currency.toUpperCase()), {
    x: width - margin - 80,
    y,
    size: 14,
    font: helvBold,
    color: NAVY,
  });

  if (args.payment.refunded_cents > 0) {
    y -= 22;
    page.drawText("Refunded", {
      x: margin,
      y,
      size: 11,
      font: helvBold,
      color: rgb(0.7, 0.2, 0.2),
    });
    page.drawText(`-${fmt(args.payment.refunded_cents, args.payment.currency.toUpperCase())}`, {
      x: width - margin - 80,
      y,
      size: 11,
      font: helvBold,
      color: rgb(0.7, 0.2, 0.2),
    });
  }

  // Footer
  page.drawText(
    "This receipt may be used for HSA/FSA reimbursement. Keep for your records.",
    { x: margin, y: 60, size: 8, font: helv, color: MUTED },
  );
  page.drawText(`Generated ${new Date().toLocaleString("en-US")}`, {
    x: margin,
    y: 48,
    size: 8,
    font: helv,
    color: MUTED,
  });

  return await doc.save();
}

function humanKind(kind: PaymentDoc["kind"]): string {
  switch (kind) {
    case "visit":
      return "Visit charge";
    case "deposit":
      return "Booking deposit";
    case "package":
      return "Package purchase";
    case "gift_card":
      return "Gift card";
    case "membership":
      return "Membership renewal";
    case "tip":
      return "Tip";
    default:
      return "Charge";
  }
}

/**
 * Render + upload + return signed-URL. Idempotent — overwrites if a
 * receipt already exists for this payment.
 */
export async function generateAndStoreReceipt(args: ReceiptArgs): Promise<{
  url: string;
  path: string;
}> {
  const bytes = await renderReceiptPdf(args);
  const path = buildPdfPath(args.tenant.id, args.payment.id);
  const file = bucket().file(path);
  await file.save(Buffer.from(bytes), {
    contentType: "application/pdf",
    metadata: {
      cacheControl: "private, max-age=0, no-cache",
      metadata: {
        tenant_id: args.tenant.id,
        payment_id: args.payment.id,
      },
    },
  });
  // 30-day signed link — receipts are sent by email and clients may
  // open them weeks later for HSA/FSA reimbursement.
  const { url } = await signedReadUrl({ storagePath: path, ttlMinutes: 60 * 24 * 30 });
  return { url, path };
}
