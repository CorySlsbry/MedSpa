"use client";

import { useEffect, useState } from "react";
import type { CampaignTriggerType, CampaignStatus } from "@/lib/firestore-types";

type Step = {
  delay_days: number;
  brief_addendum: string | null;
  call_to_action: string | null;
};

type Campaign = {
  id: string;
  trigger: CampaignTriggerType;
  channel: "email" | "sms";
  name: string;
  brief: string;
  call_to_action: string | null;
  status: CampaignStatus;
  cooldown_days: number;
  steps: Step[];
  created_at: string | null;
  updated_at: string | null;
};

const TRIGGER_LABEL: Record<CampaignTriggerType, string> = {
  birthday_week: "Birthday week",
  post_treatment_21_day: "21-day check-in",
  reactivation_90_day: "Reactivation",
  welcome_new_client: "New-client welcome",
  upsell_post_visit: "Service upsell",
};

export default function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draftSteps, setDraftSteps] = useState<Step[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/campaigns");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not load campaigns.");
      } else {
        setCampaigns(body.campaigns || []);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setStatus(id: string, status: CampaignStatus) {
    await fetch(`/api/owner/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    void load();
  }

  async function archive(id: string) {
    if (!confirm("Archive this campaign? It will stop running and be hidden from the list.")) return;
    await fetch(`/api/owner/campaigns/${id}`, { method: "DELETE" });
    void load();
  }

  async function createCampaign(form: FormData) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: String(form.get("trigger")),
          name: String(form.get("name")),
          brief: String(form.get("brief")),
          call_to_action: String(form.get("call_to_action") || "") || null,
          cooldown_days: Number(form.get("cooldown_days") || 30),
          status: form.get("activate_now") ? "active" : "draft",
          steps: draftSteps,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not create campaign.");
      } else {
        setShowForm(false);
        setDraftSteps([]);
        void load();
      }
    } catch {
      setError("Network error.");
    } finally {
      setCreating(false);
    }
  }

  function addStep() {
    setDraftSteps((prev) => [
      ...prev,
      { delay_days: prev.length === 0 ? 3 : 7, brief_addendum: null, call_to_action: null },
    ]);
  }
  function updateStep(idx: number, patch: Partial<Step>) {
    setDraftSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function removeStep(idx: number) {
    setDraftSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Persistent campaigns
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Active campaigns auto-fire on Cloud Scheduler — fully hands-off.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-ghost text-xs"
        >
          {showForm ? "Cancel" : "+ New persistent campaign"}
        </button>
      </div>

      {showForm && (
        <form
          className="mt-4 grid gap-3 rounded-lg border border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/5 p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void createCampaign(fd);
          }}
        >
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Name
            </span>
            <input
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Birthday warmth"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Trigger
            </span>
            <select
              name="trigger"
              required
              defaultValue="birthday_week"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            >
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Brief (drives the AI)
            </span>
            <textarea
              name="brief"
              required
              rows={3}
              maxLength={1000}
              placeholder="What's the campaign about? Tone, intent, anything specific…"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              CTA text
            </span>
            <input
              name="call_to_action"
              maxLength={120}
              placeholder="Book your visit"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Cooldown (days)
            </span>
            <input
              name="cooldown_days"
              type="number"
              min={0}
              max={365}
              defaultValue={30}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Drip steps {draftSteps.length === 0 ? "(optional — leave empty for single-shot)" : `(${draftSteps.length})`}
              </span>
              <button
                type="button"
                onClick={addStep}
                disabled={draftSteps.length >= 10}
                className="text-xs font-semibold text-[var(--color-gold-deep)] hover:underline disabled:opacity-40"
              >
                + Add step
              </button>
            </div>
            {draftSteps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-white px-3 py-3 text-xs text-[var(--color-ink-muted)]">
                Single-shot. Add steps to drip follow-ups (e.g. day 3 nudge, day 7 case study).
              </div>
            ) : (
              <div className="space-y-2">
                {draftSteps.map((s, i) => (
                  <div key={i} className="rounded-lg border border-[var(--color-line)] bg-white p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-[var(--color-navy)]">
                      <span>Step {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="text-[10px] font-semibold uppercase text-rose-700 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <label className="block">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                          Days after step {i}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={180}
                          value={s.delay_days}
                          onChange={(e) => updateStep(i, { delay_days: Number(e.target.value || 0) })}
                          className="mt-1 w-full rounded-md border border-[var(--color-line)] px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                          Step brief (what should this message focus on?)
                        </span>
                        <input
                          type="text"
                          value={s.brief_addendum ?? ""}
                          onChange={(e) =>
                            updateStep(i, { brief_addendum: e.target.value || null })
                          }
                          placeholder="e.g. ask if they had questions, share a case study, gentle nudge"
                          className="mt-1 w-full rounded-md border border-[var(--color-line)] px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 md:col-span-2">
            <input name="activate_now" type="checkbox" defaultChecked />
            <span className="text-sm">Activate now (otherwise it&apos;ll save as a draft)</span>
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={creating} className="btn btn-gold text-sm">
              {creating ? "Creating…" : "Create campaign"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-line)]">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            No persistent campaigns yet — create one to let it auto-fire.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Cooldown</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {campaigns.filter((c) => c.status !== "archived").map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-[var(--color-ink)]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{c.name}</span>
                      {c.steps && c.steps.length > 0 && (
                        <span className="rounded-full bg-[var(--color-teal)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-teal)]">
                          Drip · {c.steps.length} step{c.steps.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)] line-clamp-1">
                      {c.brief}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{TRIGGER_LABEL[c.trigger]}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                    {c.cooldown_days}d
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => setStatus(c.id, "paused")}
                        className="text-xs font-semibold text-[var(--color-gold-deep)] hover:underline"
                      >
                        Pause
                      </button>
                    ) : c.status === "paused" || c.status === "draft" ? (
                      <button
                        type="button"
                        onClick={() => setStatus(c.id, "active")}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Activate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => archive(c.id)}
                      className="ml-3 text-xs font-semibold text-rose-700 hover:underline"
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: CampaignStatus }) {
  const colors: Record<CampaignStatus, string> = {
    draft: "bg-gray-100 text-gray-700",
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-amber-100 text-amber-800",
    archived: "bg-rose-100 text-rose-800",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${colors[status]}`}>
      {status}
    </span>
  );
}
