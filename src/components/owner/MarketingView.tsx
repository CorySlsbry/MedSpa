"use client";

import { useState } from "react";
import type { RecentRun } from "@/app/owner/marketing/page";
import type {
  CampaignTriggerType,
  CampaignRunStatus,
} from "@/lib/firestore-types";

type Candidate = {
  id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  tags: string[];
  last_service: string | null;
  last_visit: string | null;
  days_since_last_visit: number | null;
};

type RunResult = {
  client_id: string;
  client_email: string;
  status: CampaignRunStatus;
  subject: string | null;
  preview: string | null;
  error?: string;
};

const TRIGGERS: {
  key: CampaignTriggerType;
  label: string;
  description: string;
  defaultBrief: string;
}[] = [
  {
    key: "birthday_week",
    label: "Birthday week",
    description:
      "Clients whose birthday is in the next 7 days. Warm note, optional gesture.",
    defaultBrief:
      "Send a warm birthday note. Keep it personal, not promotional. Tone: friendly, like a thoughtful friend at the front desk.",
  },
  {
    key: "post_treatment_21_day",
    label: "21-day check-in",
    description:
      "Clients who completed a treatment 18-25 days ago. Ask how they're feeling.",
    defaultBrief:
      "Three weeks since their last visit. Check in genuinely on results, invite them to share how they're feeling. Don't push for a rebook unless they bring it up.",
  },
  {
    key: "reactivation_90_day",
    label: "Reactivation",
    description:
      "Clients who haven't been in for 90+ days. Welcome them back.",
    defaultBrief:
      "It's been a while. Acknowledge time without guilt-tripping. Share something that genuinely matters (a new service, a seasonal touch). Invite them back.",
  },
  {
    key: "welcome_new_client",
    label: "New-client welcome",
    description:
      "Clients whose first visit was within the last 7 days.",
    defaultBrief:
      "Welcome a brand-new client. Set expectations for their results and the natural next step. Make them feel taken care of.",
  },
  {
    key: "upsell_post_visit",
    label: "Service upsell",
    description:
      "Clients who completed a visit 3-7 days ago. Suggest a complementary service.",
    defaultBrief:
      "Suggest a complementary service to what they just had. Tone: educational, not pushy. Spell out which service to suggest in this brief if you want a specific recommendation.",
  },
];

export default function MarketingView({
  tenantName,
  recent,
}: {
  tenantName: string;
  recent: RecentRun[];
}) {
  const [selectedTrigger, setSelectedTrigger] = useState<CampaignTriggerType | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [skipped, setSkipped] = useState<{ no_consent: number; cooldown: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [brief, setBrief] = useState("");
  const [cta, setCta] = useState("Book your visit");
  const [previewing, setPreviewing] = useState(false);
  const [previewResults, setPreviewResults] = useState<RunResult[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  function pickTrigger(t: CampaignTriggerType) {
    setSelectedTrigger(t);
    setCandidates([]);
    setSelectedIds(new Set());
    setSkipped(null);
    setPreviewResults(null);
    setSentMsg(null);
    setErrorMsg(null);
    const def = TRIGGERS.find((x) => x.key === t);
    if (def) setBrief(def.defaultBrief);
    void loadCandidates(t);
  }

  async function loadCandidates(t: CampaignTriggerType) {
    setLoadingCandidates(true);
    try {
      const res = await fetch("/api/owner/marketing/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: t }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not load candidates.");
        setCandidates([]);
        setSkipped(null);
      } else {
        setCandidates(body.candidates || []);
        setSkipped(body.skipped || null);
        setSelectedIds(new Set((body.candidates || []).map((c: Candidate) => c.id)));
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setLoadingCandidates(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generatePreview() {
    if (!selectedTrigger || selectedIds.size === 0) return;
    setPreviewing(true);
    setSentMsg(null);
    setErrorMsg(null);
    try {
      // Preview only the FIRST selected client to save AI cost
      const firstId = Array.from(selectedIds)[0];
      const res = await fetch("/api/owner/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: selectedTrigger,
          client_ids: [firstId],
          brief,
          call_to_action: cta || null,
          dry_run: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not preview.");
      } else {
        setPreviewResults(body.runs || []);
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setPreviewing(false);
    }
  }

  async function send() {
    if (!selectedTrigger || selectedIds.size === 0) return;
    if (
      !confirm(
        `Send personalized emails to ${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"}? AI generates each one. This is non-reversible.`,
      )
    )
      return;
    setSending(true);
    setSentMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/owner/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: selectedTrigger,
          client_ids: Array.from(selectedIds).slice(0, 50),
          brief,
          call_to_action: cta || null,
          dry_run: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Send failed.");
      } else {
        const sent = (body.runs || []).filter((r: RunResult) => r.status === "sent").length;
        const failed = (body.runs || []).filter((r: RunResult) => r.status === "failed").length;
        setSentMsg(
          `Sent ${sent} email${sent === 1 ? "" : "s"}${failed > 0 ? ` · ${failed} failed` : ""}. Refreshing in 2 seconds.`,
        );
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSending(false);
    }
  }

  const triggerDef = TRIGGERS.find((t) => t.key === selectedTrigger);

  return (
    <div className="space-y-8">
      {/* Trigger picker */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Pick a trigger
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TRIGGERS.map((t) => {
            const isActive = selectedTrigger === t.key;
            return (
              <button
                key={t.key}
                onClick={() => pickTrigger(t.key)}
                className={`block rounded-xl border p-4 text-left transition ${
                  isActive
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)]/5 shadow-[0_20px_60px_-30px_rgba(185,143,66,0.4)]"
                    : "border-[var(--color-line)] bg-[var(--color-paper)] hover:border-[var(--color-gold)]"
                }`}
              >
                <div className="font-display text-sm font-bold text-[var(--color-navy)]">
                  {t.label}
                </div>
                <div className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {t.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Candidate list + brief + send */}
      {selectedTrigger && triggerDef && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              {triggerDef.label}
            </h2>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {loadingCandidates
                ? "Loading…"
                : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
              {skipped && (skipped.no_consent + skipped.cooldown > 0) && (
                <span className="ml-1 text-[var(--color-ink-muted)]">
                  · {skipped.no_consent} skipped (no consent), {skipped.cooldown} skipped (cooldown)
                </span>
              )}
            </span>
          </div>

          {/* Brief */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Brief (tone + intent — drives the AI)
              </span>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
                placeholder="What's the campaign about? What tone? Anything specific to mention?"
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Call-to-action text
              </span>
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Book your visit"
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
              />
            </label>
            <div className="flex items-end">
              <button
                onClick={generatePreview}
                disabled={previewing || selectedIds.size === 0}
                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? "Generating…" : "Preview first email"}
              </button>
            </div>
          </div>

          {/* Preview card */}
          {previewResults && previewResults[0] && (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/5 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                AI preview · {previewResults[0].client_email}
              </div>
              <div className="mt-2 font-display text-sm font-bold text-[var(--color-navy)]">
                {previewResults[0].subject}
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-ink)]">
                {previewResults[0].preview}…
              </div>
              <div className="mt-2 text-[10px] text-[var(--color-ink-muted)]">
                Each client gets a unique AI-personalized version on send.
              </div>
            </div>
          )}

          {/* Candidate list */}
          <div className="mt-5 max-h-96 overflow-auto rounded-lg border border-[var(--color-line)]">
            {loadingCandidates ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
                Loading candidates…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
                No matching clients right now.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-cream-deep)]/80 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === candidates.length}
                        onChange={(e) =>
                          setSelectedIds(
                            e.target.checked ? new Set(candidates.map((c) => c.id)) : new Set(),
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Last service</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                      </td>
                      <td className="px-3 py-2 text-[var(--color-ink)]">
                        {c.preferred_name || c.full_name}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                        {c.email}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                        {c.last_service ?? "—"}
                        {c.days_since_last_visit !== null && (
                          <span className="ml-1 text-[10px]">
                            ({c.days_since_last_visit}d ago)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {sentMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {sentMsg}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-3">
            <span className="text-xs text-[var(--color-ink-muted)]">
              {selectedIds.size} selected · {tenantName}
            </span>
            <button
              onClick={send}
              disabled={sending || selectedIds.size === 0}
              className="btn btn-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending
                ? "Sending…"
                : `Send to ${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}

      {/* Recent runs */}
      <section>
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Recent sends
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {recent.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No campaigns sent yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                      {r.createdAt?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {r.trigger.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {r.clientEmail}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink)]">
                      {r.subject || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: CampaignRunStatus }) {
  const colors: Record<CampaignRunStatus, string> = {
    queued: "bg-[var(--color-gold)]/15 text-[var(--color-gold-deep)]",
    sent: "bg-emerald-100 text-emerald-800",
    delivered: "bg-emerald-100 text-emerald-800",
    opened: "bg-emerald-200 text-emerald-900",
    clicked: "bg-emerald-300 text-emerald-900",
    bounced: "bg-rose-100 text-rose-800",
    failed: "bg-rose-100 text-rose-800",
    skipped_cooldown: "bg-gray-100 text-gray-700",
    skipped_consent: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 font-semibold ${colors[status]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
