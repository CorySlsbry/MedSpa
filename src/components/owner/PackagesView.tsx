"use client";

import { useState } from "react";
import type {
  ClientOption,
  ClientPackageRow,
  GiftCardRow,
  PlanRow,
} from "@/app/owner/packages/page";

type Tab = "client_packages" | "plans" | "gift_cards";

export default function PackagesView({
  initialPlans,
  initialClientPackages,
  initialGiftCards,
  clients,
  stripeReady,
}: {
  initialPlans: PlanRow[];
  initialClientPackages: ClientPackageRow[];
  initialGiftCards: GiftCardRow[];
  clients: ClientOption[];
  stripeReady: boolean;
}) {
  const [tab, setTab] = useState<Tab>(
    initialClientPackages.length > 0 ? "client_packages" : "plans",
  );
  const [plans, setPlans] = useState(initialPlans);
  const [clientPackages, setClientPackages] = useState(initialClientPackages);
  const [giftCards, setGiftCards] = useState(initialGiftCards);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showSellModal, setShowSellModal] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [redeemTarget, setRedeemTarget] = useState<ClientPackageRow | null>(null);
  const [giftRedeemTarget, setGiftRedeemTarget] = useState<GiftCardRow | null>(null);

  const activePlans = plans.filter((p) => p.isActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(
            [
              ["client_packages", `Client packages (${clientPackages.length})`],
              ["plans", `Plans (${plans.length})`],
              ["gift_cards", `Gift cards (${giftCards.length})`],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                tab === t
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tab === "plans" && (
            <button
              type="button"
              onClick={() => setShowPlanModal(true)}
              className="btn btn-gold"
            >
              + New plan
            </button>
          )}
          {tab === "client_packages" && (
            <button
              type="button"
              onClick={() => setShowSellModal(true)}
              disabled={activePlans.length === 0 || clients.length === 0}
              className="btn btn-gold disabled:cursor-not-allowed disabled:opacity-60"
            >
              + Sell package
            </button>
          )}
          {tab === "gift_cards" && (
            <button
              type="button"
              onClick={() => setShowGiftModal(true)}
              className="btn btn-gold"
            >
              + Issue gift card
            </button>
          )}
        </div>
      </div>

      {tab === "plans" && <PlansTable plans={plans} />}
      {tab === "client_packages" && (
        <ClientPackagesTable
          rows={clientPackages}
          onRedeem={(p) => setRedeemTarget(p)}
        />
      )}
      {tab === "gift_cards" && (
        <GiftCardsTable rows={giftCards} onRedeem={(g) => setGiftRedeemTarget(g)} />
      )}

      {showPlanModal && (
        <PlanModal
          onClose={() => setShowPlanModal(false)}
          onCreated={(plan) => {
            setPlans((prev) => [...prev, plan].sort((a, b) => a.name.localeCompare(b.name)));
            setShowPlanModal(false);
          }}
        />
      )}
      {showSellModal && (
        <SellModal
          plans={activePlans}
          clients={clients}
          stripeReady={stripeReady}
          onClose={() => setShowSellModal(false)}
          onSold={() => {
            setShowSellModal(false);
            window.location.reload();
          }}
        />
      )}
      {showGiftModal && (
        <GiftIssueModal
          stripeReady={stripeReady}
          onClose={() => setShowGiftModal(false)}
          onIssued={(card) => {
            setGiftCards((prev) => [card, ...prev]);
            setShowGiftModal(false);
          }}
        />
      )}
      {redeemTarget && (
        <RedeemPackageModal
          row={redeemTarget}
          onClose={() => setRedeemTarget(null)}
          onRedeemed={(remaining) => {
            setClientPackages((prev) =>
              prev.map((p) =>
                p.id === redeemTarget.id
                  ? { ...p, sessionsRemaining: remaining, isExhausted: remaining <= 0 }
                  : p,
              ),
            );
            setRedeemTarget(null);
          }}
        />
      )}
      {giftRedeemTarget && (
        <RedeemGiftModal
          row={giftRedeemTarget}
          onClose={() => setGiftRedeemTarget(null)}
          onRedeemed={(balance) => {
            setGiftCards((prev) =>
              prev.map((g) =>
                g.code === giftRedeemTarget.code ? { ...g, balanceCents: balance } : g,
              ),
            );
            setGiftRedeemTarget(null);
          }}
        />
      )}
    </div>
  );
}

function PlansTable({ plans }: { plans: PlanRow[] }) {
  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        No plans yet. Create your first to start selling pre-paid series.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Service</th>
            <th className="px-4 py-3 text-right">Sessions</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3">Expires</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {plans.map((p) => (
            <tr key={p.id} className="hover:bg-[var(--color-cream-deep)]/30">
              <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{p.name}</td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {p.serviceName}
              </td>
              <td className="px-4 py-3 text-right text-xs">
                <span className="font-display text-base font-bold text-[var(--color-navy)]">
                  {p.sessionsTotal}
                </span>
                <span className="ml-1 text-[var(--color-ink-muted)]">
                  · ${(p.priceCents / p.sessionsTotal / 100).toFixed(0)}/ea
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-display text-base font-bold text-[var(--color-navy)]">
                  ${(p.priceCents / 100).toFixed(0)}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {p.expiresInDays ? `${p.expiresInDays} days` : "—"}
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientPackagesTable({
  rows,
  onRedeem,
}: {
  rows: ClientPackageRow[];
  onRedeem: (r: ClientPackageRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        No client packages yet. Sell your first.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Client</th>
            <th className="px-4 py-3">Package</th>
            <th className="px-4 py-3 text-right">Remaining</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Expires</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {rows.map((p) => {
            const stale = p.isExhausted || p.isExpired;
            return (
              <tr
                key={p.id}
                className={stale ? "opacity-60" : "hover:bg-[var(--color-cream-deep)]/30"}
              >
                <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">
                  {p.clientName ?? p.clientId.slice(0, 8)}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-medium text-[var(--color-ink)]">{p.planName}</div>
                  <div className="text-[10px] text-[var(--color-ink-muted)]">
                    {p.serviceName}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-display text-lg font-bold ${
                      p.isExhausted
                        ? "text-rose-700"
                        : "text-[var(--color-navy)]"
                    }`}
                  >
                    {p.sessionsRemaining}
                  </span>
                  <span className="ml-1 text-[10px] text-[var(--color-ink-muted)]">
                    / {p.sessionsTotal}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      p.source === "paid"
                        ? "bg-emerald-100 text-emerald-800"
                        : p.source === "gift"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {p.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {p.expiresAt
                    ? p.isExpired
                      ? `Expired ${p.expiresAt.toLocaleDateString()}`
                      : p.expiresAt.toLocaleDateString()
                    : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  {!stale && (
                    <button
                      type="button"
                      onClick={() => onRedeem(p)}
                      className="rounded border border-[var(--color-gold)] bg-[var(--color-gold)]/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-gold-deep)] hover:bg-[var(--color-gold)]/20"
                    >
                      Redeem
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GiftCardsTable({
  rows,
  onRedeem,
}: {
  rows: GiftCardRow[];
  onRedeem: (r: GiftCardRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        No gift cards yet. Issue your first.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Recipient</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="px-4 py-3 text-right">Original</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {rows.map((g) => {
            const isExpired = g.expiresAt ? g.expiresAt.getTime() < Date.now() : false;
            const isFully = g.fullyRedeemedAt !== null;
            return (
              <tr
                key={g.code}
                className={
                  isFully || isExpired
                    ? "opacity-60"
                    : "hover:bg-[var(--color-cream-deep)]/30"
                }
              >
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[var(--color-navy)]">
                  {g.code}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-medium text-[var(--color-ink)]">
                    {g.recipientName ?? g.recipientEmail ?? "—"}
                  </div>
                  {g.senderName && (
                    <div className="text-[10px] text-[var(--color-ink-muted)]">
                      from {g.senderName}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-display text-lg font-bold ${
                      isFully
                        ? "text-rose-700"
                        : "text-[var(--color-navy)]"
                    }`}
                  >
                    ${(g.balanceCents / 100).toFixed(0)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-[var(--color-ink-soft)]">
                  ${(g.originalAmountCents / 100).toFixed(0)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      g.source === "purchased"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {g.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {!isFully && !isExpired && (
                    <button
                      type="button"
                      onClick={() => onRedeem(g)}
                      className="rounded border border-[var(--color-gold)] bg-[var(--color-gold)]/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-gold-deep)] hover:bg-[var(--color-gold)]/20"
                    >
                      Redeem
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: PlanRow) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErr(null);
    const priceStr = String(fd.get("price") || "0");
    const expiresStr = String(fd.get("expires_in_days") || "");
    const payload = {
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim() || undefined,
      service_name: String(fd.get("service_name") || "").trim(),
      sessions_total: parseInt(String(fd.get("sessions_total") || "0"), 10),
      price_cents: Math.round(parseFloat(priceStr) * 100) || 0,
      expires_in_days: expiresStr ? parseInt(expiresStr, 10) : null,
    };
    if (!payload.name || !payload.service_name) {
      setErr("Name and service are required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/package-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not create.");
        setSubmitting(false);
        return;
      }
      onCreated({
        id: body.id,
        name: payload.name,
        description: payload.description ?? null,
        serviceName: payload.service_name,
        sessionsTotal: payload.sessions_total,
        priceCents: payload.price_cents,
        expiresInDays: payload.expires_in_days,
        isActive: true,
      });
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="New package plan">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" name="name" required placeholder="6-pack HydraFacial" />
        <Field
          label="Service it covers"
          name="service_name"
          required
          placeholder="HydraFacial"
        />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Description (optional)
          </span>
          <textarea
            name="description"
            rows={2}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Sessions"
            name="sessions_total"
            type="number"
            required
            defaultValue="6"
          />
          <Field
            label="Price ($)"
            name="price"
            type="number"
            step="0.01"
            required
            placeholder="750"
          />
        </div>
        <Field
          label="Expires in (days)"
          name="expires_in_days"
          type="number"
          placeholder="365 — blank = never"
        />
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Creating…" : "Create plan"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function SellModal({
  plans,
  clients,
  stripeReady,
  onClose,
  onSold,
}: {
  plans: PlanRow[];
  clients: ClientOption[];
  stripeReady: boolean;
  onClose: () => void;
  onSold: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErr(null);
    const payload = {
      plan_id: String(fd.get("plan_id") || ""),
      client_id: String(fd.get("client_id") || ""),
      mode: String(fd.get("mode") || "paid") as "paid" | "comp" | "gift",
      note: String(fd.get("note") || "").trim() || undefined,
    };
    if (!payload.plan_id || !payload.client_id) {
      setErr("Pick a plan and client.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/packages/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not sell.");
        setSubmitting(false);
        return;
      }
      // For paid mode, we get a client_secret; the front-desk reader confirms
      // via a dedicated checkout flow. For MVP we just confirm the back-end
      // wrote the package; the actual card capture is handled in /payments.
      onSold();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Sell package">
      <form onSubmit={submit} className="space-y-3">
        <SelectField label="Client" name="client_id" required>
          <option value="">— Select client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Plan" name="plan_id" required>
          <option value="">— Select plan —</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.sessionsTotal} sessions @ ${(p.priceCents / 100).toFixed(0)}
            </option>
          ))}
        </SelectField>
        <fieldset className="rounded-lg border border-[var(--color-line)] p-3">
          <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Payment mode
          </legend>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="paid" defaultChecked={stripeReady} disabled={!stripeReady} />
              <span>
                <span className="font-semibold">Paid</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">
                  — charge card{stripeReady ? "" : " (Connect not live)"}
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="comp" defaultChecked={!stripeReady} />
              <span>
                <span className="font-semibold">Comp</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">— no charge, comp the visit</span>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="gift" />
              <span>
                <span className="font-semibold">Gift</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">— gifted to the client</span>
              </span>
            </label>
          </div>
        </fieldset>
        <Field label="Note (optional)" name="note" />
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Selling…" : "Sell"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function GiftIssueModal({
  stripeReady,
  onClose,
  onIssued,
}: {
  stripeReady: boolean;
  onClose: () => void;
  onIssued: (g: GiftCardRow) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErr(null);
    const amountStr = String(fd.get("amount") || "0");
    const expStr = String(fd.get("expires_in_days") || "");
    const payload = {
      amount_cents: Math.round(parseFloat(amountStr) * 100) || 0,
      source: String(fd.get("source") || "purchased") as
        | "purchased"
        | "comp"
        | "manual",
      recipient_email: String(fd.get("recipient_email") || "").trim() || undefined,
      recipient_name: String(fd.get("recipient_name") || "").trim() || undefined,
      sender_name: String(fd.get("sender_name") || "").trim() || undefined,
      message: String(fd.get("message") || "").trim() || undefined,
      expires_in_days: expStr ? parseInt(expStr, 10) : undefined,
    };
    if (payload.amount_cents < 500) {
      setErr("Amount must be at least $5.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not issue.");
        setSubmitting(false);
        return;
      }
      onIssued({
        code: body.code,
        originalAmountCents: payload.amount_cents,
        balanceCents: payload.amount_cents,
        recipientEmail: payload.recipient_email ?? null,
        recipientName: payload.recipient_name ?? null,
        senderName: payload.sender_name ?? null,
        message: payload.message ?? null,
        expiresAt: body.expires_at ? new Date(body.expires_at) : null,
        source: payload.source,
        fullyRedeemedAt: null,
        createdAt: new Date(),
      });
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Issue gift card">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)" name="amount" type="number" step="0.01" required placeholder="100" />
          <Field
            label="Expires in (days)"
            name="expires_in_days"
            type="number"
            placeholder="365 — blank = never"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recipient name" name="recipient_name" />
          <Field label="Recipient email" name="recipient_email" type="email" />
        </div>
        <Field label="Sender name" name="sender_name" />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Message (optional)
          </span>
          <textarea
            name="message"
            rows={2}
            placeholder="Happy birthday!"
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        <fieldset className="rounded-lg border border-[var(--color-line)] p-3">
          <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Source
          </legend>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="source"
                value="purchased"
                defaultChecked={stripeReady}
                disabled={!stripeReady}
              />
              <span>
                <span className="font-semibold">Purchased</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">
                  — buyer pays now{stripeReady ? "" : " (Connect not live)"}
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="source" value="comp" defaultChecked={!stripeReady} />
              <span>
                <span className="font-semibold">Comp</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">— gift, no charge</span>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="source" value="manual" />
              <span>
                <span className="font-semibold">Manual</span>
                <span className="ml-1 text-[var(--color-ink-muted)]">— add to balance only</span>
              </span>
            </label>
          </div>
        </fieldset>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Issuing…" : "Issue card"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function RedeemPackageModal({
  row,
  onClose,
  onRedeemed,
}: {
  row: ClientPackageRow;
  onClose: () => void;
  onRedeemed: (remaining: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErr(null);
    const sessions = parseInt(String(fd.get("sessions") || "1"), 10);
    if (!sessions || sessions < 1) {
      setErr("Sessions must be at least 1.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`/api/owner/client-packages/${row.id}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessions,
          appointment_id: String(fd.get("appointment_id") || "").trim() || undefined,
          reason: String(fd.get("reason") || "").trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not redeem.");
        setSubmitting(false);
        return;
      }
      onRedeemed(body.sessions_remaining);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Redeem from ${row.planName}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          <span className="font-bold text-[var(--color-navy)]">{row.sessionsRemaining}</span>{" "}
          of {row.sessionsTotal} sessions remaining
          {row.expiresAt && (
            <span className="text-[var(--color-ink-muted)]">
              {" "}· expires {row.expiresAt.toLocaleDateString()}
            </span>
          )}
        </div>
        <Field
          label="Sessions to redeem"
          name="sessions"
          type="number"
          defaultValue="1"
          required
        />
        <Field label="Appointment ID (optional)" name="appointment_id" />
        <Field label="Note" name="reason" />
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Redeeming…" : "Redeem"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function RedeemGiftModal({
  row,
  onClose,
  onRedeemed,
}: {
  row: GiftCardRow;
  onClose: () => void;
  onRedeemed: (balance: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = parseFloat(String(fd.get("amount") || "0"));
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Enter a positive amount.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/owner/gift-cards/${row.code}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_cents: Math.round(amount * 100),
          applied_to: "manual",
          reason: String(fd.get("reason") || "").trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not redeem.");
        setSubmitting(false);
        return;
      }
      onRedeemed(body.balance_cents);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Redeem ${row.code}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          Balance:{" "}
          <span className="font-bold text-[var(--color-navy)]">
            ${(row.balanceCents / 100).toFixed(2)}
          </span>
          <span className="text-[var(--color-ink-muted)]">
            {" "}
            (orig ${(row.originalAmountCents / 100).toFixed(2)})
          </span>
        </div>
        <Field label="Amount to draw ($)" name="amount" type="number" step="0.01" required />
        <Field label="Note" name="reason" />
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Redeeming…" : "Redeem"}
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
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
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
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
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
