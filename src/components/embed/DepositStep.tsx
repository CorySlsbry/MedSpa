"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

export type DepositPayload = {
  clientSecret: string;
  amountCents: number;
  publishableKey: string;
  connectAccountId: string;
};

export default function DepositStep({
  accent,
  payload,
  serviceName,
  slotLabel,
  onPaid,
}: {
  accent: string;
  payload: DepositPayload;
  serviceName: string;
  slotLabel: string;
  onPaid: () => void;
}) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    setStripePromise(
      loadStripe(payload.publishableKey, {
        stripeAccount: payload.connectAccountId,
      }),
    );
  }, [payload.publishableKey, payload.connectAccountId]);

  if (!stripePromise) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-center text-sm text-[var(--color-ink-muted)]">
        Loading secure payment…
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: payload.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: accent,
            colorBackground: "#ffffff",
            colorText: "#1b2636",
            colorDanger: "#b91c1c",
            fontFamily: "system-ui, -apple-system, sans-serif",
            spacingUnit: "5px",
            borderRadius: "10px",
          },
        },
      }}
    >
      <DepositForm
        accent={accent}
        amountCents={payload.amountCents}
        serviceName={serviceName}
        slotLabel={slotLabel}
        onPaid={onPaid}
      />
    </Elements>
  );
}

function DepositForm({
  accent,
  amountCents,
  serviceName,
  slotLabel,
  onPaid,
}: {
  accent: string;
  amountCents: number;
  serviceName: string;
  slotLabel: string;
  onPaid: () => void;
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
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // The deposit is held — Stripe redirects only for 3DS challenges
        return_url: window.location.href,
      },
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }
    onPaid();
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[var(--color-line)] bg-white p-6 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Booking deposit
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-[var(--color-navy)]">
            ${(amountCents / 100).toFixed(2)}
          </div>
        </div>
        <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
          Secured by Stripe
        </div>
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Holds your slot — applied to your visit, refunded if you cancel 24+ hours ahead.
      </p>
      <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2 text-xs">
        <div className="font-semibold text-[var(--color-ink)]">{serviceName}</div>
        <div className="text-[var(--color-ink-muted)]">{slotLabel}</div>
      </div>
      <div className="mt-4">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>
      {err && (
        <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="mt-5 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-70"
        style={{ background: accent }}
      >
        {submitting ? "Processing…" : `Pay $${(amountCents / 100).toFixed(2)} to confirm`}
      </button>
      <p className="mt-3 text-center text-[10px] text-[var(--color-ink-muted)]">
        We never store your card. Stripe handles all payment data securely.
      </p>
    </form>
  );
}
