/**
 * Consent helpers — PDF rendering + signature handling for digital
 * consent forms. Server-side only.
 *
 * The signed PDF stores the captured signature as an embedded PNG plus
 * the frozen template body, signer info, IP, UA, and timestamp.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { bucket } from "./storage";

export function newSigningToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Decode a "data:image/png;base64,..." data URL into a raw PNG Buffer
 * suitable for pdf-lib.embedPng. Throws on malformed input.
 */
export function pngFromDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Signature must be a PNG data URL.");
  return Buffer.from(m[1], "base64");
}

export function buildSignaturePath(args: { tenantId: string; consentId: string }): string {
  return `tenants/${args.tenantId}/consents/${args.consentId}/signature.png`;
}

export function buildPdfPath(args: { tenantId: string; consentId: string }): string {
  return `tenants/${args.tenantId}/consents/${args.consentId}/consent.pdf`;
}

export async function uploadBytesToBucket(
  storagePath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket().file(storagePath).save(Buffer.from(bytes), {
    contentType,
    resumable: false,
    metadata: { cacheControl: "private, max-age=0, no-transform" },
  });
}

export type ConsentPdfArgs = {
  tenantName: string;
  templateName: string;
  body: string;
  signerName: string;
  signerEmail: string;
  signerIp: string | null;
  signerUserAgent: string | null;
  signedAtIso: string;
  signaturePng: Buffer;
};

/**
 * Render the signed consent PDF. Letter size, single page that flows.
 * Returns the raw bytes ready to upload to Cloud Storage.
 */
export async function renderConsentPdf(args: ConsentPdfArgs): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sigImage = await pdf.embedPng(args.signaturePng);

  const pageMargin = 54; // 0.75"
  let page = pdf.addPage([612, 792]); // letter
  let { width, height } = page.getSize();
  let y = height - pageMargin;
  const drawText = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const font = options.font ?? helv;
    const size = options.size ?? 11;
    const lineHeight = size * 1.4;
    const wrapped = wrapText(text, font, size, width - pageMargin * 2);
    for (const line of wrapped) {
      if (y < pageMargin + 60) {
        page = pdf.addPage([612, 792]);
        ({ width, height } = page.getSize());
        y = height - pageMargin;
      }
      page.drawText(line, {
        x: pageMargin,
        y,
        size,
        font,
        color: options.color ?? rgb(0.05, 0.1, 0.18),
      });
      y -= lineHeight;
    }
  };

  // Header
  drawText(args.tenantName, { font: helvBold, size: 18, color: rgb(0.1, 0.15, 0.25) });
  drawText(`Consent: ${args.templateName}`, { font: helvBold, size: 13, color: rgb(0.5, 0.4, 0.15) });
  y -= 6;
  page.drawLine({
    start: { x: pageMargin, y },
    end: { x: width - pageMargin, y },
    thickness: 0.5,
    color: rgb(0.7, 0.65, 0.5),
  });
  y -= 18;

  // Body — paragraph by paragraph
  for (const para of args.body.split(/\n\n+/)) {
    drawText(para.trim());
    y -= 8;
  }

  // Signer block
  y -= 12;
  drawText("Signer", { font: helvBold, size: 12 });
  drawText(`Name: ${args.signerName}`, { size: 10 });
  drawText(`Email: ${args.signerEmail}`, { size: 10 });
  drawText(`Signed: ${args.signedAtIso}`, { size: 10 });
  if (args.signerIp) drawText(`IP: ${args.signerIp}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  if (args.signerUserAgent)
    drawText(`User agent: ${args.signerUserAgent.slice(0, 200)}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });

  // Signature
  y -= 18;
  if (y < pageMargin + 100) {
    page = pdf.addPage([612, 792]);
    ({ width, height } = page.getSize());
    y = height - pageMargin;
  }
  drawText("Signature", { font: helvBold, size: 12 });
  const sigDims = sigImage.scale(0.5);
  const sigW = Math.min(sigDims.width, 360);
  const sigH = sigW * (sigImage.height / sigImage.width);
  const sigY = y - sigH - 4;
  page.drawImage(sigImage, {
    x: pageMargin,
    y: sigY,
    width: sigW,
    height: sigH,
  });
  page.drawLine({
    start: { x: pageMargin, y: sigY - 4 },
    end: { x: pageMargin + sigW, y: sigY - 4 },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText(args.signerName, {
    x: pageMargin,
    y: sigY - 16,
    size: 9,
    font: helv,
    color: rgb(0.45, 0.45, 0.45),
  });

  return pdf.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  for (const raw of text.split(/\n/)) {
    if (!raw.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(test, size);
      if (w > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
