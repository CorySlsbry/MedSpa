"use client";

import { useMemo, useState } from "react";

export type ClientRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  last_visit_iso: string | null;
};

/**
 * Shared clients table — used by manager / front-desk / provider.
 * Server-side parents fetch + filter (e.g. provider gets only clients
 * they've treated). Client-side here we just add a search box for
 * convenience, since the data is already scoped by the server.
 */
export default function TenantClientsList({
  clients,
  emptyMessage,
}: {
  clients: ClientRow[];
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      return (
        c.full_name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [clients, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, email, phone, or tag…"
        className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
      />
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-ink-muted)]">
          {query
            ? `No clients match "${query}".`
            : (emptyMessage ?? "No clients to show.")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr className="border-b border-[var(--color-line)]">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Tags</th>
                <th className="px-4 py-2.5 text-right">Last visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[var(--color-navy)]">{c.full_name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-ink-soft)]">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {c.tags.length === 0 ? (
                      <span className="text-xs text-[var(--color-ink-muted)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-[var(--color-cream-deep)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]"
                          >
                            {t}
                          </span>
                        ))}
                        {c.tags.length > 3 && (
                          <span className="text-[9px] text-[var(--color-ink-muted)]">
                            +{c.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-[var(--color-ink-muted)]">
                    {c.last_visit_iso
                      ? new Date(c.last_visit_iso).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[var(--color-ink-muted)]">
        Showing {filtered.length} of {clients.length} clients.
      </p>
    </div>
  );
}
