import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";

export const metadata: Metadata = { title: "Manager · Complaints", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Manager complaints queue. Today this is a stub view that explains the
 * intended flow — once we wire complaint tagging onto ConversationDoc,
 * this page will list those threads here.
 *
 * For v1, the manager handles complaints via the inbox where the Manager
 * AI can draft a response. This page exists so the nav doesn't 404 and
 * documents the future flow.
 */
export default async function ManagerComplaintsPage() {
  await requireTenantContext("tenant_manager");

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Complaints
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Complaint queue
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Customer-service tickets — the Manager AI can draft a measured
        response, you review and send.
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
          How this works
        </div>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--color-ink-soft)]">
          <li>
            Front desk receives a complaint via SMS or email — both flow into
            the{" "}
            <Link href="/manager/inbox" className="font-semibold text-[var(--color-teal)] hover:underline">
              inbox
            </Link>.
          </li>
          <li>
            Front desk applies the <code className="rounded bg-[var(--color-paper)] px-1.5 py-0.5 font-mono text-[10px]">complaint</code> tag to the thread to flag it for management review.
          </li>
          <li>
            The Manager AI drafts a measured response based on your clinic&apos;s
            voice + the recent visit history. You review and send.
          </li>
          <li>
            Resolution gets logged on the client record so future bookings
            surface the context.
          </li>
        </ol>
      </div>

      <p className="mt-6 text-xs text-[var(--color-ink-muted)]">
        Open complaints land here once the team starts tagging threads. Until
        then, ask the Manager AI &quot;show me unhappy clients this week&quot; —
        bottom-right pill.
      </p>
    </div>
  );
}
