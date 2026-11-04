import type { Metadata } from "next";
import Link from "next/link";
import { db, toDate } from "@/lib/firestore";
import { getSessionUser } from "@/lib/auth-server";
import { Timestamp } from "firebase-admin/firestore";
import type { ContactDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Admin · Email monitor",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Email-deliverability dashboard. Reads scheduled_emails for the last 30
 * days in a single scan and tallies everything in memory. The bounce →
 * DND flow runs unconditionally via the Resend webhook
 * (src/app/api/marketing/webhook/resend/route.ts); this page just makes
 * the result visible.
 *
 * Why a scan instead of count() aggregations: at low/moderate volume
 * (low thousands of docs) a single scan is cheaper than maintaining 5+
 * composite indexes, and we get every metric + the recent-bounces list
 * + sample data from the same read. Earlier version used count()
 * queries with `.catch(() => null)` — that silently swallowed
 * "missing index" errors and showed 0 sent for weeks while the cron was
 * actually shipping email. We now let read errors surface.
 *
 * Hard rule: a single hard or soft bounce flips the contact to
 * do_not_contact=true + adds a `dnd:bounce_*` tag + cancels every queued
 * scheduled_emails row for that recipient. No further sends fire.
 */
export default async function EmailMonitorPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") return null;

  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // One scan over the 30-day window. No `.catch(() => null)` — if this
  // throws, the page errors loudly so we notice instead of rendering 0s.
  const windowSnap = await db()
    .collection("scheduled_emails")
    .where("created_at", ">=", since)
    .get();

  let total = 0;
  let sent = 0;
  let delivered = 0;
  let bounced = 0;
  let failed = 0;
  let skipped = 0;

  // Collect bounce events on the fly — saves a second query.
  type BounceRow = {
    id: string;
    email: string;
    reason: string;
    at: Date | null;
    type: string;
    step: string;
  };
  const bounceRows: BounceRow[] = [];

  for (const d of windowSnap.docs) {
    const x = d.data() as {
      status?: string;
      delivered_at?: Timestamp | null;
      bounced_at?: Timestamp | null;
      bounce_reason?: string;
      recipient_email?: string;
      type?: string;
      step?: string;
      step_index?: number;
    };
    total++;
    if (x.status === "sent") sent++;
    if (x.status === "failed") failed++;
    if (x.status === "skipped") skipped++;
    if (x.delivered_at) delivered++;
    if (x.bounced_at) {
      bounced++;
      bounceRows.push({
        id: d.id,
        email: x.recipient_email ?? "(unknown)",
        reason: x.bounce_reason ?? "bounced",
        at: toDate(x.bounced_at),
        type: x.type ?? "—",
        step: x.step ?? (x.step_index !== undefined ? `step ${x.step_index}` : "—"),
      });
    }
  }

  bounceRows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  const recentBounces = bounceRows.slice(0, 20);

  // Queued-now is intentionally all-time, not 30-day-windowed: if a row
  // queued 35 days ago is still pending, we want to see it.
  const queuedSnap = await db()
    .collection("scheduled_emails")
    .where("status", "==", "queued")
    .count()
    .get();
  const queued = queuedSnap.data().count;

  const bounceRatePct = sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0;
  const deliveryRatePct = sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0;

  // Recent DND-flagged contacts
  const dndSnap = await db()
    .collection("contacts")
    .where("do_not_contact", "==", true)
    .orderBy("last_dnd_at", "desc")
    .limit(50)
    .get();

  const dndContacts = dndSnap.docs.map((d) => {
    const c = d.data() as ContactDoc & {
      last_dnd_reason?: string;
      last_dnd_detail?: string;
      last_dnd_at?: Timestamp;
    };
    return {
      id: d.id,
      email: c.email,
      name: c.full_name,
      company: c.company_name,
      reason: c.last_dnd_reason ?? "—",
      detail: c.last_dnd_detail ?? null,
      at: toDate(c.last_dnd_at ?? null),
    };
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Email monitor
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Last 30 days. Bounce → DND auto-flagging is wired: any bounce or
        complaint flips the contact to do-not-contact + cancels queued sends
        immediately, no manual intervention required.
      </p>

      {/* Top-line metrics */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Sent" value={sent.toLocaleString()} sub={`of ${total.toLocaleString()} attempted`} />
        <Tile label="Delivered" value={delivered.toLocaleString()} sub={`${deliveryRatePct}% delivery rate`} />
        <Tile
          label="Bounced"
          value={bounced.toLocaleString()}
          sub={`${bounceRatePct}% bounce rate`}
          tone={bounceRatePct >= 5 ? "rose" : bounceRatePct >= 2 ? "amber" : "emerald"}
        />
        <Tile label="Queued (now)" value={queued.toLocaleString()} sub="awaiting cron fire" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Tile label="Failed" value={failed.toLocaleString()} sub="provider rejected" tone="rose" small />
        <Tile label="Skipped (DND, etc.)" value={skipped.toLocaleString()} sub="never sent" small />
        <Tile label="DND contacts (30d)" value={dndContacts.length.toString()} sub="auto-flagged" tone="amber" small />
      </div>

      {/* Industry context */}
      <div className="mt-6 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-4 text-xs text-[var(--color-ink-soft)]">
        <strong className="block text-sm text-[var(--color-navy)]">What&apos;s a healthy bounce rate?</strong>
        <ul className="mt-2 space-y-0.5">
          <li>• Under 2% — clean list, healthy sender reputation.</li>
          <li>• 2–5% — watch closely, especially if cold-outreach. Tighten ICP.</li>
          <li>• 5%+ — Resend / GMail / Outlook will start throttling. Review the bounce list below.</li>
          <li>• 10%+ — risk of domain blacklist. Pause campaigns, audit list quality, consider a list-cleaning service before resuming.</li>
        </ul>
      </div>

      {/* Recent DND-flagged contacts */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Recently DND-flagged contacts
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Anyone the bounce/complaint/unsubscribe pipeline auto-flagged. They
            won&apos;t receive any further email from this platform.
          </p>
        </div>
        {dndContacts.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            No DND-flagged contacts yet. Clean list.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr className="border-b border-[var(--color-line)]">
                <th className="px-5 py-2">Contact</th>
                <th className="px-5 py-2">Reason</th>
                <th className="px-5 py-2">Detail</th>
                <th className="px-5 py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {dndContacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2.5">
                    <div className="font-semibold text-[var(--color-navy)]">{c.email}</div>
                    {c.name && (
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        {c.name}{c.company ? ` · ${c.company}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <ReasonPill reason={c.reason} />
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-ink-soft)]">
                    {c.detail
                      ? c.detail.slice(0, 120) + (c.detail.length > 120 ? "…" : "")
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[11px] text-[var(--color-ink-muted)]">
                    {c.at ? c.at.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent bounce events */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Recent bounce events
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Last 20 bounced sends across the platform — useful for spotting
            patterns (one bad domain, one bad workflow step).
          </p>
        </div>
        {recentBounces.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            No bounces recorded.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr className="border-b border-[var(--color-line)]">
                <th className="px-5 py-2">Recipient</th>
                <th className="px-5 py-2">Reason</th>
                <th className="px-5 py-2">Source</th>
                <th className="px-5 py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {recentBounces.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-2.5 font-mono text-xs text-[var(--color-navy)]">
                    {b.email}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-ink-soft)]">
                    {b.reason.slice(0, 100)}
                  </td>
                  <td className="px-5 py-2.5 text-[11px] text-[var(--color-ink-muted)]">
                    {b.type} · {b.step}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[11px] text-[var(--color-ink-muted)]">
                    {b.at ? b.at.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-6 text-xs text-[var(--color-ink-muted)]">
        Bounce + delivery events come from the Resend webhook at{" "}
        <code className="font-mono">/api/marketing/webhook/resend</code>. If
        these tiles ever show 0 for a sender that&apos;s actively sending,
        verify the webhook secret + Resend dashboard config — see{" "}
        <Link href="/admin/integrations" className="font-semibold text-[var(--color-teal)] hover:underline">
          Integrations
        </Link>.
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "amber" | "rose";
  small?: boolean;
}) {
  const palette =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/40"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/50"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50/50"
          : "border-[var(--color-line)] bg-[var(--color-paper)]";
  return (
    <div className={`rounded-xl border p-4 ${palette}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className={`mt-1 font-display font-bold tabular-nums text-[var(--color-navy)] ${small ? "text-xl" : "text-2xl"}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-soft)]">{sub}</div>
      )}
    </div>
  );
}

function ReasonPill({ reason }: { reason: string }) {
  const map: Record<string, string> = {
    bounce_hard: "bg-rose-100 text-rose-800",
    bounce_soft: "bg-amber-100 text-amber-800",
    complained: "bg-rose-100 text-rose-800",
    unsubscribed: "bg-[var(--color-cream-deep)] text-[var(--color-ink-soft)]",
    manual: "bg-sky-100 text-sky-800",
  };
  const cls = map[reason] ?? "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {reason.replace(/_/g, " ")}
    </span>
  );
}
