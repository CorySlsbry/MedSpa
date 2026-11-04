"use client";

import { useState } from "react";
import type { ClientRow, LocationOption } from "@/app/owner/clients/page";

type ImportResult = {
  created: number;
  skipped: number;
  total: number;
  errors: { row: number; reason: string }[];
};

export default function ClientsView({
  initialRows,
  locations,
}: {
  initialRows: ClientRow[];
  locations: LocationOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState("");

  async function uploadCsv(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setImporting(true);
    setErrorMsg(null);
    setImportResult(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("csv") as File | null;
    if (!file || file.size === 0) {
      setErrorMsg("Pick a CSV file to upload.");
      setImporting(false);
      return;
    }
    if (file.size > 5_000_000) {
      setErrorMsg("File too large (max 5 MB).");
      setImporting(false);
      return;
    }
    try {
      const text = await file.text();
      const res = await fetch("/api/owner/clients/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Import failed.");
        setImporting(false);
        return;
      }
      setImportResult(body);
      // Soft refresh to surface new rows
      if (body.created > 0) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setErrorMsg("Could not read or upload that file.");
    } finally {
      setImporting(false);
    }
  }

  const visible = filter
    ? rows.filter((r) =>
        [r.fullName, r.email, r.phone].some((v) =>
          v?.toLowerCase().includes(filter.toLowerCase()),
        ),
      )
    : rows;

  async function createClient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const tagsStr = String(fd.get("tags") || "").trim();
    const payload = {
      email: String(fd.get("email") || "").trim().toLowerCase(),
      full_name: String(fd.get("full_name") || "").trim(),
      preferred_name: String(fd.get("preferred_name") || "").trim() || undefined,
      phone: String(fd.get("phone") || "").trim() || undefined,
      date_of_birth: String(fd.get("date_of_birth") || "").trim() || undefined,
      default_location_id: String(fd.get("default_location_id") || "") || undefined,
      email_consent: fd.get("email_consent") === "on",
      sms_consent: fd.get("sms_consent") === "on",
      tags: tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [],
    };
    if (!payload.email || !payload.full_name) {
      setErrorMsg("Email and name are required.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not create client.");
        setCreating(false);
        return;
      }
      const newRow: ClientRow = {
        id: body.id,
        email: payload.email,
        fullName: payload.full_name,
        preferredName: payload.preferred_name ?? null,
        phone: payload.phone ?? null,
        defaultLocationId: payload.default_location_id ?? null,
        tags: payload.tags,
        emailConsent: payload.email_consent,
        smsConsent: payload.sms_consent,
        createdAt: new Date(),
      };
      setRows((prev) => [newRow, ...prev]);
      formEl.reset();
      setShowCreate(false);
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by name, email, or phone…"
          className="w-full max-w-md flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
        />
        <div className="flex items-center gap-2">
          {!showImport && !showCreate && (
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
            >
              Import CSV
            </button>
          )}
          {!showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn btn-gold whitespace-nowrap">
              + Add a client
            </button>
          )}
        </div>
      </div>

      {showImport && (
        <form
          onSubmit={uploadCsv}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              Bulk import clients (CSV)
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowImport(false);
                setImportResult(null);
              }}
              className="text-xs text-[var(--color-ink-muted)] hover:underline"
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Required columns: <code className="font-mono">email</code>,{" "}
            <code className="font-mono">full_name</code>. Optional:{" "}
            <code className="font-mono">phone</code>,{" "}
            <code className="font-mono">preferred_name</code>,{" "}
            <code className="font-mono">date_of_birth</code>,{" "}
            <code className="font-mono">tags</code> (semicolon-separated).
            Max 1000 rows. Duplicates by email are skipped.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              required
              className="text-sm"
            />
            <button
              type="submit"
              disabled={importing}
              className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
            >
              {importing ? "Uploading..." : "Upload CSV"}
            </button>
          </div>
          {importResult && (
            <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              Created {importResult.created} of {importResult.total} rows
              {importResult.skipped > 0 && ` · skipped ${importResult.skipped}`}.
              {importResult.errors.length > 0 && (
                <details className="mt-2 cursor-pointer">
                  <summary className="font-semibold">View errors</summary>
                  <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5">
                    {importResult.errors.map((e, idx) => (
                      <li key={idx}>
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {errorMsg && !importResult && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
        </form>
      )}

      {showCreate && (
        <form
          onSubmit={createClient}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              New client
            </h2>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs text-[var(--color-ink-muted)] hover:underline"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Email" name="email" type="email" required />
            <Field label="Full name" name="full_name" required />
            <Field label="Preferred name" name="preferred_name" />
            <Field label="Phone" name="phone" type="tel" />
            <Field label="Date of birth" name="date_of_birth" type="date" />
            {locations.length > 0 && (
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Default location
                </span>
                <select
                  name="default_location_id"
                  className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                >
                  <option value="">— Any —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field
              label="Tags (comma-separated)"
              name="tags"
              placeholder="vip, botox, returning"
              className="md:col-span-2"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="email_consent" defaultChecked />
              Email marketing consent
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="sms_consent" />
              SMS marketing consent
            </label>
          </div>
          {errorMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="submit"
              disabled={creating}
              className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
            >
              {creating ? "Creating..." : "Create client"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            {rows.length === 0 ? "No clients yet." : "No matches."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
                  <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">
                    {r.preferredName || r.fullName}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    <a href={`mailto:${r.email}`} className="hover:underline">
                      {r.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.phone || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-[var(--color-cream-deep)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-ink-soft)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                    {r.createdAt?.toLocaleDateString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
  className,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}
