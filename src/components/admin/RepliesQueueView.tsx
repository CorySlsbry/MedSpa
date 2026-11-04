"use client";

import { useState } from "react";
import type { InboundReplyRow } from "@/app/admin/(dashboard)/replies/page";

const CLASS_PILL: Record<string, string> = {
  needs_reply: "bg-amber-100 text-amber-900",
  out_of_office: "bg-slate-200 text-slate-700",
  unsubscribed: "bg-rose-100 text-rose-800",
};
const STATUS_PILL: Record<string, string> = {
  awaiting_review: "bg-amber-100 text-amber-900",
  needs_manual: "bg-rose-100 text-rose-800",
  approved: "bg-emerald-100 text-emerald-800",
  sent: "bg-emerald-100 text-emerald-800",
  discarded: "bg-slate-200 text-slate-700",
  skipped: "bg-slate-200 text-slate-700",
};

export default function RepliesQueueView({
  rows,
  tab,
}: {
  rows: InboundReplyRow[];
  tab: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-8 text-center">
        <div className="text-sm text-[var(--color-ink-muted)]">
          {tab === "awaiting"
            ? "Nothing awaiting your review. When prospects reply to a nurture email, AI drafts will appear here."
            : tab === "skipped"
              ? "No auto-handled replies yet."
              : "No inbound replies yet."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <ReplyCard key={r.id} row={r} />
      ))}
    </div>
  );
}

function ReplyCard({ row }: { row: InboundReplyRow }) {
  const [draft, setDraft] = useState(row.aiDraft ?? "");
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [done, setDone] = useState<"sent" | "discarded" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAwaiting = row.status === "awaiting_review" || row.status === "needs_manual";

  async function send() {
    if (!draft.trim()) {
      setError("Draft is empty.");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/admin/replies/${row.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Send failed.");
      }
      setDone("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    setError(null);
    try {
      const res = await fetch(`/api/admin/replies/${row.id}/discard`, { method: "POST" });
      if (!res.ok) throw new Error("Discard failed.");
      setDone("discarded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discard failed.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-5 text-sm text-[var(--color-ink-muted)]">
        <span className="font-semibold text-[var(--color-navy)]">{row.fromEmail}</span> ·{" "}
        {done === "sent" ? "Reply sent." : "Discarded."}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--color-navy)]">
            {row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}
          </div>
          <div className="text-[11px] text-[var(--color-ink-muted)]">
            {row.clinicName ? `${row.clinicName} · ` : ""}
            replying to: <span className="font-mono">{row.outboundSubject || "(unknown)"}</span>
            {" · "}
            {row.receivedAt}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CLASS_PILL[row.classification] || CLASS_PILL.needs_reply}`}>
            {row.classification.replace(/_/g, " ")}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[row.status] || STATUS_PILL.awaiting_review}`}>
            {row.status.replace(/_/g, " ")}
          </span>
        </div>
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <section>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
            Their reply
          </div>
          <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)]/40 p-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            {row.inboundText || "(empty body)"}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-gold-deep)]">
              ✦ Sonnet draft
            </div>
            {row.tokensIn > 0 && (
              <div className="text-[10px] text-[var(--color-ink-muted)]">
                {row.tokensIn} in · {row.tokensOut} out
              </div>
            )}
          </div>
          {row.draftError ? (
            <div className="mt-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              Draft failed: {row.draftError}. Reply manually below.
            </div>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!isAwaiting || busy !== null}
            rows={11}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white p-3 font-mono text-xs leading-relaxed text-[var(--color-ink) ] focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            placeholder="Draft your reply…"
          />
        </section>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {isAwaiting && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={busy !== null}
            className="rounded-md border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream-deep)] disabled:opacity-50"
          >
            {busy === "discard" ? "Discarding…" : "Discard"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy !== null}
            className="rounded-md bg-[var(--color-gold)] px-4 py-1.5 text-xs font-semibold text-[var(--color-navy-deep)] transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Approve & send →"}
          </button>
        </div>
      )}
    </div>
  );
}
