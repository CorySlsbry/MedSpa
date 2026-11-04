/**
 * /admin/replies — inbound reply approval queue.
 *
 * Lists every row in `inbound_replies` with status="awaiting_review",
 * showing the prospect's email, the original outbound subject, the
 * inbound text, and the AI-drafted reply. Each row gets three buttons:
 * Approve & Send, Edit & Send, Discard.
 *
 * Skipped (OOO) and unsubscribed entries are accessible via a tab toggle
 * but minimized by default — Cory shouldn't have to click through them.
 */

import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import RepliesQueueView from "@/components/admin/RepliesQueueView";

export const metadata: Metadata = {
  title: "Admin · Replies",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type InboundReplyRow = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  clinicName: string | null;
  outboundSubject: string;
  inboundSubject: string;
  inboundText: string;
  classification: string;
  aiDraft: string | null;
  draftError: string | null;
  status: string;
  receivedAt: string;
  tokensIn: number;
  tokensOut: number;
};

export default async function RepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "all" ? "all" : sp.tab === "skipped" ? "skipped" : "awaiting";

  const limit = 100;
  let snap;
  if (tab === "awaiting") {
    snap = await db()
      .collection("inbound_replies")
      .where("status", "==", "awaiting_review")
      .orderBy("received_at", "desc")
      .limit(limit)
      .get()
      .catch(() => null);
  } else if (tab === "skipped") {
    snap = await db()
      .collection("inbound_replies")
      .where("classification", "in", ["out_of_office", "unsubscribed"])
      .orderBy("received_at", "desc")
      .limit(limit)
      .get()
      .catch(() => null);
  } else {
    snap = await db()
      .collection("inbound_replies")
      .orderBy("received_at", "desc")
      .limit(limit)
      .get()
      .catch(() => null);
  }

  const rows: InboundReplyRow[] = (snap?.docs ?? []).map((d) => {
    const e = d.data() as Record<string, unknown>;
    const ra = e.received_at;
    return {
      id: d.id,
      fromEmail: String(e.from_email ?? ""),
      fromName: (e.from_name as string | null) ?? null,
      clinicName: (e.clinic_name as string | null) ?? null,
      outboundSubject: String(e.outbound_subject ?? ""),
      inboundSubject: String(e.inbound_subject ?? ""),
      inboundText: String(e.inbound_text ?? ""),
      classification: String(e.classification ?? "needs_reply"),
      aiDraft: (e.ai_draft as string | null) ?? null,
      draftError: (e.draft_error as string | null) ?? null,
      status: String(e.status ?? "awaiting_review"),
      receivedAt:
        ra instanceof Timestamp ? ra.toDate().toLocaleString() : String(ra ?? ""),
      tokensIn: Number(e.tokens_in ?? 0),
      tokensOut: Number(e.tokens_out ?? 0),
    };
  });

  // Quick counts for the header
  const awaitingSnap = await db()
    .collection("inbound_replies")
    .where("status", "==", "awaiting_review")
    .count()
    .get()
    .catch(() => null);
  const awaitingCount = awaitingSnap?.data()?.count ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Reply queue
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            AI-drafted replies to inbound nurture responses, awaiting your approval.
            Unsubscribe asks and out-of-office auto-replies are handled automatically.
          </p>
        </div>
        <div className="flex gap-1">
          {([
            { k: "awaiting", l: `Awaiting review${awaitingCount ? ` (${awaitingCount})` : ""}` },
            { k: "skipped", l: "Auto-handled" },
            { k: "all", l: "All" },
          ] as const).map((t) => (
            <a
              key={t.k}
              href={`?tab=${t.k}`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                t.k === tab
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {t.l}
            </a>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <RepliesQueueView rows={rows} tab={tab} />
      </div>
    </div>
  );
}
