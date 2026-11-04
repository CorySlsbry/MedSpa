"use client";

import { useEffect, useState } from "react";
import SignaturePad from "./SignaturePad";

type ConsentData = {
  consent: {
    id: string;
    template_name: string;
    body: string;
    client_name: string;
    client_email: string;
    expires_at: string | null;
  };
  tenant: { name: string; primary_color: string | null; logo_url: string | null } | null;
};

export default function ConsentSignFlow({ token }: { token: string }) {
  const [data, setData] = useState<ConsentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/consents/${token}`);
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(body?.error || "This link isn't valid.");
        } else {
          setData(body);
          setSignerName(body.consent.client_name || "");
          setSignerEmail(body.consent.client_email || "");
        }
      } catch {
        if (alive) setError("Network error.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!signature) {
      setError("Please sign before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/consents/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim().toLowerCase(),
          signature_data_url: signature,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not save your signature.");
        setSubmitting(false);
        return;
      }
      setSigned(true);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center text-sm text-gray-500">
        Loading consent…
      </main>
    );
  }
  if (error && !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </main>
    );
  }
  if (!data) return null;

  const accent = data.tenant?.primary_color || "#b98f42";

  if (signed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-8 text-center">
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: "#059669" }}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-emerald-900">Signed.</h1>
          <p className="mt-2 text-sm text-emerald-800">
            Thanks, {signerName.split(" ")[0]}. Your consent is on file with {data.tenant?.name ?? "the clinic"}.
            You can close this tab.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-gray-50 px-4 py-8 md:px-8 md:py-12">
      <header className="mb-6 flex items-center gap-3">
        {data.tenant?.logo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={data.tenant.logo_url} alt={data.tenant.name} className="h-10 w-auto" />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg font-display text-base font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {(data.tenant?.name ?? "A").slice(0, 1)}
          </div>
        )}
        <div>
          <div className="font-display text-base font-bold text-gray-900">
            {data.tenant?.name ?? "Aesthera"}
          </div>
          <div className="text-xs uppercase tracking-wider" style={{ color: accent }}>
            Consent for {data.consent.template_name}
          </div>
        </div>
      </header>

      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="font-display text-2xl font-bold text-gray-900">
          {data.consent.template_name}
        </h1>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {data.consent.body}
        </div>
      </article>

      <form
        onSubmit={submit}
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="font-display text-lg font-bold text-gray-900">Sign</h2>
        <p className="mt-1 text-xs text-gray-500">
          By typing your name and signing below, you agree to the consent above.
          A signed PDF will be filed with the clinic.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Full name
            </span>
            <input
              required
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Email
            </span>
            <input
              type="email"
              required
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Signature
          </span>
          <div className="mt-1">
            <SignaturePad onChange={setSignature} accent={accent} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !signature || !signerName.trim() || !signerEmail.trim()}
          className="mt-5 w-full rounded-lg px-4 py-3 font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {submitting ? "Saving…" : "Sign + submit"}
        </button>
        <p className="mt-3 text-center text-[10px] text-gray-400">
          Aesthera securely stores your signature with timestamp + IP for the clinic's records.
        </p>
      </form>
    </main>
  );
}
