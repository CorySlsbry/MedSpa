"use client";

import { useCallback, useEffect, useState } from "react";

type Template = {
  id: string;
  name: string;
  description: string | null;
  body: string;
  version: number;
  status: "draft" | "active" | "archived";
};

type Consent = {
  id: string;
  template_id: string;
  template_name: string;
  client_id: string | null;
  client_email: string;
  client_name: string;
  status: "pending" | "signed" | "expired" | "revoked";
  signing_token: string | null;
  signed_at: string | null;
  expires_at: string | null;
  has_pdf: boolean;
  signer_typed_name: string | null;
};

const STARTER_BODY = `By signing below, I acknowledge I have been informed of the procedure, the risks, the alternatives, and the expected results. I have had the opportunity to ask questions and they have been answered to my satisfaction.

I understand that medical aesthetic procedures carry inherent risks including but not limited to bruising, swelling, infection, asymmetry, and unsatisfactory results. I confirm that the medical history I have provided is true and complete to the best of my knowledge.

I authorize the provider to perform the agreed-upon treatment and to take photographs as part of my medical record. I understand that the photographs will be stored securely and used only for treatment, internal review, and (with separate explicit consent) for educational or marketing purposes.

I have read this consent in full and accept the terms.`;

export default function ConsentsView() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSend, setShowSend] = useState<Template | null>(null);

  const load = useCallback(async () => {
    try {
      const [tplRes, conRes] = await Promise.all([
        fetch("/api/owner/consent-templates"),
        fetch("/api/owner/consents"),
      ]);
      const tplBody = await tplRes.json();
      const conBody = await conRes.json();
      if (tplRes.ok) setTemplates(tplBody.templates || []);
      if (conRes.ok) setConsents(conBody.consents || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function downloadPdf(consentId: string) {
    const res = await fetch(`/api/owner/consents/${consentId}/pdf`);
    const body = await res.json();
    if (res.ok && body.url) window.open(body.url, "_blank");
    else setError(body?.error || "Could not open PDF.");
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}
      {toast && (
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {toast}
        </div>
      )}

      {/* Templates */}
      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              Templates
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              Re-usable consent boilerplate per service category.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="btn btn-ghost text-xs"
          >
            {showNew ? "Cancel" : "+ New template"}
          </button>
        </div>

        {showNew && (
          <TemplateForm
            initial={null}
            onCancel={() => setShowNew(false)}
            onSaved={() => {
              setShowNew(false);
              flash("Template saved.");
              void load();
            }}
            onError={setError}
          />
        )}
        {editing && (
          <TemplateForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              flash("Template updated.");
              void load();
            }}
            onError={setError}
          />
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-line)]">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
              Loading…
            </div>
          ) : templates.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
              No templates yet. Start with the Botox + filler boilerplate.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">v</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--color-navy)]">{t.name}</div>
                      {t.description && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)] line-clamp-1">
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        t.status === "active" ? "bg-emerald-100 text-emerald-800"
                          : t.status === "draft" ? "bg-gray-100 text-gray-700"
                          : "bg-rose-100 text-rose-800"
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-[var(--color-ink-muted)]">{t.version}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setShowSend(t)}
                        disabled={t.status !== "active"}
                        className="text-xs font-semibold text-[var(--color-teal)] hover:underline disabled:opacity-40"
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        className="ml-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showSend && (
        <SendConsentModal
          template={showSend}
          onClose={() => setShowSend(null)}
          onSent={(url) => {
            setShowSend(null);
            flash(`Signing link ready. Copy from above or share: ${url}`);
            void load();
          }}
          onError={setError}
        />
      )}

      {/* Recent consents */}
      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Recent consents
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          All requests + signed records.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-line)]">
          {consents.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
              No consent records yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Signed</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {consents.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-[var(--color-ink)]">{c.client_name}</div>
                      <div className="text-[var(--color-ink-muted)]">{c.client_email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{c.template_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        c.status === "signed" ? "bg-emerald-100 text-emerald-800"
                          : c.status === "pending" ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-700"
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                      {c.signed_at ? new Date(c.signed_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.status === "pending" && c.signing_token && (
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/consent/${c.signing_token}`;
                            void navigator.clipboard.writeText(url).catch(() => undefined);
                            flash("Signing link copied.");
                          }}
                          className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
                        >
                          Copy link
                        </button>
                      )}
                      {c.has_pdf && (
                        <button
                          type="button"
                          onClick={() => downloadPdf(c.id)}
                          className="ml-3 text-xs font-semibold text-[var(--color-navy)] hover:underline"
                        >
                          PDF →
                        </button>
                      )}
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

function TemplateForm({
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  initial: Template | null;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? STARTER_BODY);
  const [activate, setActivate] = useState(initial ? initial.status === "active" : true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const url = initial
        ? `/api/owner/consent-templates/${initial.id}`
        : "/api/owner/consent-templates";
      const method = initial ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          body,
          status: activate ? "active" : "draft",
        }),
      });
      const responseBody = await res.json();
      if (!res.ok) {
        onError(responseBody?.error || "Save failed.");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/5 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Template name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Botox treatment consent"
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Description (internal)
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Used for all neurotoxin services"
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Body (plain text — paragraphs separated by a blank line)
        </span>
        <textarea
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-xs"
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        Active (clients can be sent links to this template)
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !name || body.length < 20}
          className="btn btn-gold text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Create template"}
        </button>
      </div>
    </div>
  );
}

function SendConsentModal({
  template,
  onClose,
  onSent,
  onError,
}: {
  template: Template;
  onClose: () => void;
  onSent: (url: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: template.id,
          client_name: name,
          client_email: email,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.signing_url) {
        onError(body?.error || "Could not create signing link.");
        return;
      }
      setCreatedUrl(body.signing_url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Send consent: {template.name}
        </h3>

        {!createdUrl ? (
          <>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Generate a signing link the client can open from any browser.
              Link expires in 30 days.
            </p>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Client name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Client email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !name || !email}
                className="btn btn-gold text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate signing link"}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4">
            <p className="text-xs text-[var(--color-ink-muted)]">
              Send this link to {name}:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={createdUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(createdUrl).catch(() => undefined);
                }}
                className="rounded-lg bg-[var(--color-navy)] px-3 py-2 text-xs font-semibold text-[var(--color-cream)]"
              >
                Copy
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => onSent(createdUrl)} className="btn btn-gold text-sm">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
