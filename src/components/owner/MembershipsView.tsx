"use client";

import { useMemo, useState } from "react";
import type {
  PlanRow,
  MembershipRow,
  ClientOption,
} from "@/app/owner/memberships/page";
import type {
  MembershipStatus,
  MembershipBillingPeriod,
} from "@/lib/firestore-types";
import CardSetupModal from "./CardSetupModal";

const STATUS_LABEL: Record<MembershipStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  paused: "Paused",
};

const STATUS_COLOR: Record<MembershipStatus, string> = {
  trialing: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  past_due: "bg-rose-100 text-rose-800",
  canceled: "bg-gray-100 text-gray-700",
  paused: "bg-blue-100 text-blue-800",
};

export default function MembershipsView({
  initialPlans,
  initialMemberships,
  clients,
}: {
  initialPlans: PlanRow[];
  initialMemberships: MembershipRow[];
  clients: ClientOption[];
}) {
  const [plans, setPlans] = useState(initialPlans);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [tab, setTab] = useState<"members" | "plans">(
    initialMemberships.length > 0 ? "members" : "plans",
  );
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [editPlan, setEditPlan] = useState<PlanRow | null>(null);
  const [enroll, setEnroll] = useState(false);
  const [actionTarget, setActionTarget] = useState<{
    membership: MembershipRow;
    action: ActionKind;
  } | null>(null);
  const [cardSetupTarget, setCardSetupTarget] = useState<MembershipRow | null>(null);

  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["members", "plans"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${
                tab === t
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {t === "members" ? `Members (${memberships.length})` : `Plans (${plans.length})`}
            </button>
          ))}
        </div>
        {tab === "plans" ? (
          <button type="button" onClick={() => setShowAddPlan(true)} className="btn btn-gold">
            + Add plan
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnroll(true)}
            disabled={activePlans.length === 0 || clients.length === 0}
            className="btn btn-gold disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Enroll member
          </button>
        )}
      </div>

      {tab === "plans" && (
        <PlansTable plans={plans} onEdit={(p) => setEditPlan(p)} />
      )}

      {tab === "members" && (
        <MembersTable
          memberships={memberships}
          onAction={(m, a) => setActionTarget({ membership: m, action: a })}
          onSetupCard={(m) => setCardSetupTarget(m)}
        />
      )}

      {showAddPlan && (
        <PlanFormModal
          onClose={() => setShowAddPlan(false)}
          onCreated={(plan) => {
            setPlans((prev) => [...prev, plan].sort((a, b) => a.name.localeCompare(b.name)));
            setShowAddPlan(false);
          }}
        />
      )}

      {editPlan && (
        <PlanFormModal
          existing={editPlan}
          onClose={() => setEditPlan(null)}
          onUpdated={(updated) => {
            setPlans((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p)),
            );
            setEditPlan(null);
          }}
          onArchived={() => {
            setPlans((prev) =>
              prev.map((p) =>
                p.id === editPlan.id ? { ...p, isActive: false } : p,
              ),
            );
            setEditPlan(null);
          }}
        />
      )}

      {enroll && (
        <EnrollModal
          plans={activePlans}
          clients={clients}
          onClose={() => setEnroll(false)}
          onCreated={() => {
            setEnroll(false);
            window.location.reload();
          }}
        />
      )}

      {actionTarget && (
        <ActionModal
          membership={actionTarget.membership}
          action={actionTarget.action}
          onClose={() => setActionTarget(null)}
          onApplied={(updates) => {
            setMemberships((prev) =>
              prev.map((m) =>
                m.id === actionTarget.membership.id ? { ...m, ...updates } : m,
              ),
            );
            setActionTarget(null);
          }}
        />
      )}

      {cardSetupTarget && (
        <CardSetupModal
          membershipId={cardSetupTarget.id}
          clientName={cardSetupTarget.clientName}
          planName={cardSetupTarget.planNameSnapshot}
          onClose={() => setCardSetupTarget(null)}
          onSaved={(card) => {
            setMemberships((prev) =>
              prev.map((m) =>
                m.id === cardSetupTarget.id
                  ? {
                      ...m,
                      autoBill: true,
                      cardBrand: card.brand,
                      cardLast4: card.last4,
                      failedPaymentCount: 0,
                    }
                  : m,
              ),
            );
            setCardSetupTarget(null);
          }}
        />
      )}
    </div>
  );
}

function PlansTable({
  plans,
  onEdit,
}: {
  plans: PlanRow[];
  onEdit: (p: PlanRow) => void;
}) {
  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        No plans yet. Click + Add plan to create your first membership offering.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Credit / period</th>
            <th className="px-4 py-3">Discounts</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {plans.map((p) => (
            <tr key={p.id} className="hover:bg-[var(--color-cream-deep)]/30">
              <td className="px-4 py-3">
                <div className="font-semibold text-[var(--color-navy)]">{p.name}</div>
                {p.description && (
                  <div className="text-[10px] text-[var(--color-ink-muted)] line-clamp-1">
                    {p.description}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink)]">
                <div className="font-bold">${(p.priceCents / 100).toFixed(0)}</div>
                <div className="text-[10px] text-[var(--color-ink-muted)]">
                  per {p.billingPeriod === "yearly" ? "year" : "month"}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {p.creditPerPeriodCents > 0
                  ? `$${(p.creditPerPeriodCents / 100).toFixed(0)}`
                  : "—"}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {[
                  p.serviceDiscountPct > 0 ? `${p.serviceDiscountPct}% services` : null,
                  p.retailDiscountPct > 0 ? `${p.retailDiscountPct}% retail` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
              <td className="px-4 py-3">
                {p.isActive ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    active
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                    archived
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ActionKind = "renew" | "cancel" | "pause" | "resume" | "credit" | "redeem";

function MembersTable({
  memberships,
  onAction,
  onSetupCard,
}: {
  memberships: MembershipRow[];
  onAction: (m: MembershipRow, a: ActionKind) => void;
  onSetupCard: (m: MembershipRow) => void;
}) {
  if (memberships.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        No active memberships yet. Switch to the Plans tab and create at least one plan, then click + Enroll member.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Member</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Renews</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {memberships.map((m) => {
            const isActive = m.status === "active" || m.status === "trialing";
            return (
              <tr key={m.id} className="hover:bg-[var(--color-cream-deep)]/30">
                <td className="px-4 py-3">
                  <div className="font-semibold text-[var(--color-navy)]">
                    {m.clientName ?? m.clientId.slice(0, 8)}
                  </div>
                  <div className="text-[10px] text-[var(--color-ink-muted)]">
                    Started {m.startedAt?.toLocaleDateString() ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-medium text-[var(--color-ink)]">{m.planNameSnapshot}</div>
                  <div className="text-[10px] text-[var(--color-ink-muted)]">
                    ${(m.priceCentsSnapshot / 100).toFixed(0)} / {m.billingPeriodSnapshot === "yearly" ? "yr" : "mo"}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {m.status === "canceled"
                    ? `Ends ${m.currentPeriodEnd?.toLocaleDateString() ?? "—"}`
                    : m.status === "paused"
                    ? `Paused until ${m.pausedUntil?.toLocaleDateString() ?? "—"}`
                    : m.nextRenewalAt?.toLocaleDateString() ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-display text-base font-bold ${
                      m.balanceCents < 0 ? "text-rose-700" : "text-[var(--color-navy)]"
                    }`}
                  >
                    ${(m.balanceCents / 100).toFixed(0)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_COLOR[m.status]}`}
                    >
                      {STATUS_LABEL[m.status]}
                    </span>
                    {m.autoBill && m.cardLast4 && (
                      <span className="text-[10px] text-[var(--color-ink-muted)]">
                        Auto-bill · {m.cardBrand?.toUpperCase() ?? "card"} ••{m.cardLast4}
                      </span>
                    )}
                    {m.autoBill && !m.cardLast4 && (
                      <span className="text-[10px] text-amber-700">Card not on file</span>
                    )}
                    {m.failedPaymentCount > 0 && m.status !== "canceled" && (
                      <span className="text-[10px] font-semibold text-rose-700">
                        Payment failed {m.failedPaymentCount}×
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    {isActive && (
                      <>
                        <button
                          type="button"
                          onClick={() => onSetupCard(m)}
                          className="rounded border border-[var(--color-gold)] bg-[var(--color-gold)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--color-gold-deep)] hover:bg-[var(--color-gold)]/20"
                        >
                          {m.cardLast4 ? "Update card" : "Set up card"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction(m, "renew")}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          Renew
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction(m, "credit")}
                          className="rounded border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                        >
                          Credit
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction(m, "redeem")}
                          className="rounded border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                        >
                          Redeem
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction(m, "pause")}
                          className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          onClick={() => onAction(m, "cancel")}
                          className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {m.status === "paused" && (
                      <button
                        type="button"
                        onClick={() => onAction(m, "resume")}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        Resume
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanFormModal({
  existing,
  onClose,
  onCreated,
  onUpdated,
  onArchived,
}: {
  existing?: PlanRow;
  onClose: () => void;
  onCreated?: (plan: PlanRow) => void;
  onUpdated?: (plan: PlanRow) => void;
  onArchived?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSubmitting(true);
    setErr(null);
    const priceStr = String(fd.get("price") || "0");
    const creditStr = String(fd.get("credit") || "0");
    const payload = {
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim() || undefined,
      billing_period: String(fd.get("billing_period") || "monthly") as MembershipBillingPeriod,
      price_cents: Math.round(parseFloat(priceStr) * 100) || 0,
      credit_per_period_cents: Math.round(parseFloat(creditStr) * 100) || 0,
      service_discount_pct: parseInt(String(fd.get("service_discount_pct") || "0"), 10) || 0,
      retail_discount_pct: parseInt(String(fd.get("retail_discount_pct") || "0"), 10) || 0,
      perks_text: String(fd.get("perks_text") || "").trim() || undefined,
    };
    if (!payload.name) {
      setErr("Name is required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = existing
        ? await fetch(`/api/owner/membership-plans/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/owner/membership-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not save.");
        setSubmitting(false);
        return;
      }
      const plan: PlanRow = {
        id: existing?.id ?? body.id,
        name: payload.name,
        description: payload.description ?? null,
        billingPeriod: payload.billing_period,
        priceCents: payload.price_cents,
        creditPerPeriodCents: payload.credit_per_period_cents,
        serviceDiscountPct: payload.service_discount_pct,
        retailDiscountPct: payload.retail_discount_pct,
        perksText: payload.perks_text ?? null,
        isActive: existing?.isActive ?? true,
      };
      if (existing) onUpdated?.(plan);
      else onCreated?.(plan);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  async function archive() {
    if (!existing) return;
    if (!confirm(`Archive ${existing.name}? Existing members keep their terms; new enrollments are blocked.`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/owner/membership-plans/${existing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b?.error || "Could not archive.");
        setSubmitting(false);
        return;
      }
      onArchived?.();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={existing ? `Edit ${existing.name}` : "New plan"}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Plan name" name="name" required defaultValue={existing?.name} placeholder="VIP Aesthetic" />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Description
          </span>
          <textarea
            name="description"
            rows={2}
            defaultValue={existing?.description ?? ""}
            placeholder="One-line pitch — shown to members on enrollment"
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Billing period"
            name="billing_period"
            defaultValue={existing?.billingPeriod ?? "monthly"}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </SelectField>
          <Field
            label="Price ($)"
            name="price"
            type="number"
            required
            step="0.01"
            defaultValue={existing ? (existing.priceCents / 100).toFixed(2) : ""}
            placeholder="149"
          />
        </div>
        <Field
          label="Credit per period ($, optional)"
          name="credit"
          type="number"
          step="0.01"
          defaultValue={existing ? (existing.creditPerPeriodCents / 100).toFixed(2) : ""}
          placeholder="25"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Service discount (%)"
            name="service_discount_pct"
            type="number"
            defaultValue={existing ? String(existing.serviceDiscountPct) : "0"}
          />
          <Field
            label="Retail discount (%)"
            name="retail_discount_pct"
            type="number"
            defaultValue={existing ? String(existing.retailDiscountPct) : "0"}
          />
        </div>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Perks (free-form)
          </span>
          <textarea
            name="perks_text"
            rows={3}
            defaultValue={existing?.perksText ?? ""}
            placeholder="1 free HydraFacial / month, free brow waxes, priority booking..."
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-between pt-2">
          {existing ? (
            <button
              type="button"
              onClick={archive}
              disabled={submitting}
              className="text-xs font-semibold text-rose-700 hover:underline disabled:opacity-70"
            >
              Archive plan
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
              {submitting ? "Saving..." : existing ? "Save" : "Create plan"}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function EnrollModal({
  plans,
  clients,
  onClose,
  onCreated,
}: {
  plans: PlanRow[];
  clients: ClientOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const startStr = String(fd.get("start_date") || "");
    setSubmitting(true);
    setErr(null);
    const payload = {
      client_id: String(fd.get("client_id") || ""),
      plan_id: String(fd.get("plan_id") || ""),
      start_date: startStr ? new Date(startStr).toISOString() : undefined,
      notes: String(fd.get("notes") || "").trim() || undefined,
      auto_bill: fd.get("auto_bill") === "on",
    };
    if (!payload.client_id || !payload.plan_id) {
      setErr("Pick a client and a plan.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/client-memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not enroll.");
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Enroll member">
      <form onSubmit={submit} className="space-y-3">
        <SelectField label="Client" name="client_id" required>
          <option value="">— Select client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </SelectField>
        <SelectField label="Plan" name="plan_id" required>
          <option value="">— Select plan —</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — ${(p.priceCents / 100).toFixed(0)}/{p.billingPeriod === "yearly" ? "yr" : "mo"}
            </option>
          ))}
        </SelectField>
        <Field label="Start date (defaults to today)" name="start_date" type="date" />
        <label className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2 text-xs text-[var(--color-ink)]">
          <input type="checkbox" name="auto_bill" className="h-4 w-4" />
          <span>
            <span className="font-semibold">Auto-bill renewals</span>
            <span className="ml-1 text-[var(--color-ink-muted)]">— card on file required (set up after enrolling)</span>
          </span>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Notes
          </span>
          <textarea
            name="notes"
            rows={2}
            placeholder="How they paid, special arrangements..."
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Enrolling..." : "Enroll"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ActionModal({
  membership,
  action,
  onClose,
  onApplied,
}: {
  membership: MembershipRow;
  action: ActionKind;
  onClose: () => void;
  onApplied: (updates: Partial<MembershipRow>) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const titleByAction: Record<ActionKind, string> = {
    renew: `Renew ${membership.planNameSnapshot}`,
    cancel: `Cancel ${membership.planNameSnapshot}`,
    pause: `Pause ${membership.planNameSnapshot}`,
    resume: `Resume ${membership.planNameSnapshot}`,
    credit: `Add credit to ${membership.clientName ?? "member"}`,
    redeem: `Redeem credit from ${membership.clientName ?? "member"}`,
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSubmitting(true);
    setErr(null);

    const body: Record<string, unknown> = { action };
    if (action === "credit" || action === "redeem") {
      const amt = Number(fd.get("amount"));
      if (!Number.isFinite(amt) || amt <= 0) {
        setErr("Amount must be a positive number.");
        setSubmitting(false);
        return;
      }
      body.amount_cents = Math.round(amt * 100);
      body.reason = String(fd.get("reason") || "").trim() || undefined;
    }
    if (action === "cancel") {
      body.reason = String(fd.get("reason") || "").trim() || undefined;
    }
    if (action === "pause") {
      const until = String(fd.get("until") || "");
      if (!until) {
        setErr("Pick a date to resume.");
        setSubmitting(false);
        return;
      }
      body.until = new Date(until).toISOString();
    }

    try {
      const res = await fetch(`/api/owner/client-memberships/${membership.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json?.error || "Could not apply.");
        setSubmitting(false);
        return;
      }
      const updates: Partial<MembershipRow> = {
        status: json.status,
        balanceCents: json.balance_cents,
        nextRenewalAt: json.next_renewal_at ? new Date(json.next_renewal_at) : null,
      };
      if (action === "cancel") updates.canceledAt = new Date();
      if (action === "pause" && body.until) updates.pausedUntil = new Date(body.until as string);
      if (action === "resume") updates.pausedUntil = null;
      onApplied(updates);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={titleByAction[action]}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          Current balance: <span className="font-bold text-[var(--color-navy)]">${(membership.balanceCents / 100).toFixed(2)}</span>
        </div>
        {(action === "credit" || action === "redeem") && (
          <>
            <Field label="Amount ($)" name="amount" type="number" step="0.01" required />
            <Field label="Reason / note" name="reason" placeholder="Birthday gift, comp for missed visit..." />
          </>
        )}
        {action === "cancel" && (
          <Field label="Reason (optional)" name="reason" placeholder="Moved away, complaint, etc." />
        )}
        {action === "pause" && (
          <Field label="Resume on" name="until" type="date" required />
        )}
        {action === "renew" && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            Rolls the period forward by {membership.billingPeriodSnapshot === "yearly" ? "1 year" : "1 month"} and
            adds the plan&apos;s period credit (if any).
          </p>
        )}
        {action === "resume" && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            Sets the membership active immediately. Renewal date is unchanged from before pause.
          </p>
        )}
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-70 ${
              action === "cancel" ? "bg-rose-600 hover:bg-rose-700" : "bg-[var(--color-gold-deep)] hover:bg-[var(--color-gold)]"
            }`}
          >
            {submitting ? "Applying..." : "Apply"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs text-[var(--color-ink-muted)] hover:underline">
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        step={step}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  required,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
