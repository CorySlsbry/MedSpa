"use client";

import { useMemo, useState } from "react";
import type { ClientPhotoRow } from "@/app/client/photos/page";

export default function ClientPhotosView({ photos }: { photos: ClientPhotoRow[] }) {
  const [filter, setFilter] = useState<"all" | "pairs">("pairs");
  const [zoom, setZoom] = useState<{ url: string; label: string | null } | null>(null);

  // Group paired photos
  const pairs = useMemo(() => {
    const byId = new Map<string, ClientPhotoRow>();
    photos.forEach((p) => byId.set(p.id, p));
    const groups = new Map<string, ClientPhotoRow[]>();
    photos.forEach((p) => {
      const key = p.pairId
        ? [p.id, p.pairId].sort().join(":")
        : `solo:${p.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    });
    // Order each pair: before → after → during → other
    const order: Record<string, number> = { before: 0, after: 1, during: 2, other: 3 };
    for (const list of groups.values()) {
      list.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
    }
    void byId;
    return Array.from(groups.values()).sort((a, b) => {
      const aT = a[0]?.takenAt?.getTime() ?? 0;
      const bT = b[0]?.takenAt?.getTime() ?? 0;
      return bT - aT;
    });
  }, [photos]);

  if (photos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        Your provider hasn&apos;t added photos yet. They show up here once they capture before/after shots during a visit.
      </div>
    );
  }

  const visible =
    filter === "pairs" ? pairs.filter((g) => g.length >= 2 || g[0]?.kind !== "other") : pairs;

  return (
    <div>
      <div className="flex gap-2">
        {(["pairs", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${
              filter === f
                ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
            }`}
          >
            {f === "pairs" ? "Before & after" : "All photos"}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {visible.map((group, idx) => (
          <div
            key={`group-${idx}`}
            className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-sm"
          >
            <div className={`grid ${group.length >= 2 ? "grid-cols-2" : "grid-cols-1"}`}>
              {group.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setZoom({ url: p.url, label: p.label })}
                  className="relative aspect-square overflow-hidden bg-[var(--color-cream-deep)]"
                >
                  <img src={p.url} alt={p.label ?? p.kind} className="h-full w-full object-cover" />
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${kindColor(p.kind)}`}
                  >
                    {p.kind}
                  </span>
                </button>
              ))}
            </div>
            <div className="px-4 py-3">
              {group[0]?.label && (
                <div className="font-semibold text-[var(--color-ink)]">{group[0].label}</div>
              )}
              {group[0]?.takenAt && (
                <div className="text-xs text-[var(--color-ink-muted)]">
                  {group[0].takenAt.toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          <div className="max-h-full max-w-3xl">
            <img
              src={zoom.url}
              alt={zoom.label ?? "photo"}
              className="max-h-[85vh] max-w-full rounded-lg shadow-2xl"
            />
            {zoom.label && (
              <div className="mt-3 text-center text-sm text-white">{zoom.label}</div>
            )}
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="mt-3 block w-full text-center text-xs text-white/80 underline"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <p className="mt-6 text-[11px] text-[var(--color-ink-muted)]">
        Photos are private and shared only with you and your provider. They never
        appear in marketing or social posts without your written consent.
      </p>
    </div>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case "before":
      return "bg-amber-100 text-amber-900";
    case "after":
      return "bg-emerald-100 text-emerald-800";
    case "during":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}
