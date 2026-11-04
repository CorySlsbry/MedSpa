"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

type Setup = {
  clientSecret: string;
  publishableKey: string;
  stripeAccountId: string;
};

export default function CardSetupModal({
  membershipId,
  clientName,
  planName,
  onClose,
  onSaved,
}: {
  membershipId: string;
  clientName: string | null;
  planName: string;
  onClose: () => void;
  onSaved: (card: { brand: string | null; last4: string | null }) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/owner/client-memberships/${membershipId}/setup-card`,
          { method: "POST" },
        );
        const body = await res.json();
        if (!alive) return;
        if (
          !res.ok ||
          !body.client_secret ||
          !body.publishable_key ||
          !body.stripe_account_id
        ) {
          setLoadErr(body?.error || "Could not start card setup.");
          return;
        }
        setSetup({
          clientSecret: body.client_secret,
          publishableKey: body.publishable_key,
          stripeAccountId: body.stripe_account_id,
        });
      } catch {
        setLoadErr("Network error.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [membershipId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Card on file
            </div>
            <h3 className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
              Save card for {clientName ?? "member"}
            </h3>
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              {planName} — auto-renewals will charge this card
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
            Close
          </button>
        </div>

        <div className="mt-5">
          {loadErr ? (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {loadErr}
            </div>
          ) : !setup ? (
            <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-6 text-center text-xs text-[var(--color-ink-muted)]">
              Loading secure form…
            </div>
          ) : (
            <SetupShell setup={setup} membershipId={membershipId} onSaved={onSaved} />
          )}
        </div>
      </div>
    </div>
  );
}

function SetupShell({
  setup,
  membershipId,
  onSaved,
}: {
  setup: Setup;
  membershipId: string;
  onSaved: (card: { brand: string | null; last4: string | null }) => void;
}) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(
    null,
  );
  useEffect(() => {
    setStripePromise(
      loadStripe(setup.publishableKey, { stripeAccount: setup.stripeAccountId }),
    );
  }, [setup.publishableKey, setup.stripeAccountId]);

  if (!stripePromise) return null;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: setup.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#b98f42",
            colorBackground: "#ffffff",
            colorText: "#1b2636",
            fontFamily: "system-ui, -apple-system, sans-serif",
            borderRadius: "10px",
          },
        },
      }}
    >
      <SetupForm membershipId={membershipId} onSaved={onSaved} />
    </Elements>
  );
}

function SetupForm({
  membershipId,
  onSaved,
}: {
  membershipId: string;
  onSaved: (card: { brand: string | null; last4: string | null }) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message ?? "Could not save card.");
      setSubmitting(false);
      return;
    }
    if (!setupIntent || setupIntent.status !== "succeeded") {
      setErr("Setup didn't complete.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/owner/client-memberships/${membershipId}/save-card`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setup_intent_id: setupIntent.id }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error || "Couldn't persist card.");
        setSubmitting(false);
        return;
      }
      onSaved({ brand: body.card_brand ?? null, last4: body.card_last4 ?? null });
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PaymentElement options={{ layout: "tabs" }} />
      {err && (
        <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="mt-4 w-full rounded-lg bg-[var(--color-navy)] px-4 py-3 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "Saving…" : "Save card on file"}
      </button>
      <p className="mt-3 text-center text-[10px] text-[var(--color-ink-muted)]">
        We never store the full card. Stripe stores it encrypted; we keep the brand + last 4.
      </p>
    </form>
  );
}
