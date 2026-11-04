"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LiveCaptureCamera from "./LiveCaptureCamera";
import PhonePairing from "./PhonePairing";

type Photo = {
  id: string;
  client_id: string;
  appointment_id: string | null;
  chart_id: string | null;
  storage_path: string;
  content_type: string;
  byte_size: number;
  kind: "before" | "after" | "during" | "other";
  label: string | null;
  notes: string | null;
  taken_at: string | null;
  pair_id: string | null;
  width: number | null;
  height: number | null;
  created_at: string | null;
};

const KIND_ACCENT: Record<Photo["kind"], string> = {
  before: "bg-amber-100 text-amber-800",
  after: "bg-emerald-100 text-emerald-800",
  during: "bg-blue-100 text-blue-800",
  other: "bg-gray-100 text-gray-700",
};

export default function ChartPhotos({
  clientId,
  appointmentId,
  chartId,
  signed,
}: {
  clientId: string;
  appointmentId: string;
  chartId: string | null;
  signed: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/photos?client_id=${encodeURIComponent(clientId)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not load photos.");
        setPhotos([]);
        return;
      }
      setPhotos(body.photos || []);
    } catch {
      setError("Network error.");
      setPhotos([]);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve signed read URLs in batches
  useEffect(() => {
    if (!photos || photos.length === 0) return;
    let alive = true;
    (async () => {
      const need = photos.filter((p) => !urls[p.id]);
      if (need.length === 0) return;
      const updates: Record<string, string> = {};
      for (const p of need) {
        try {
          const res = await fetch(`/api/photos/${p.id}/url`);
          const body = await res.json();
          if (res.ok && body.url) updates[p.id] = body.url;
        } catch {
          /* ignore */
        }
      }
      if (alive && Object.keys(updates).length > 0) {
        setUrls((cur) => ({ ...cur, ...updates }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [photos, urls]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    let i = 0;
    for (const file of Array.from(files)) {
      i++;
      setUploading(i);
      const ok = await uploadOne(file);
      if (!ok) break;
    }
    setUploading(null);
    void load();
  }

  async function uploadOne(file: File): Promise<boolean> {
    if (!file.type.startsWith("image/")) {
      setError(`${file.name} isn't an image.`);
      return false;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError(`${file.name} is over 25 MB.`);
      return false;
    }
    // Step 1: get signed URL
    let init;
    try {
      const res = await fetch("/api/photos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          content_type: file.type,
          byte_size: file.size,
        }),
      });
      init = await res.json();
      if (!res.ok || !init?.upload_url) {
        setError(init?.error || "Could not start upload.");
        return false;
      }
    } catch {
      setError("Network error starting upload.");
      return false;
    }

    // Step 2: PUT to GCS directly
    try {
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-goog-content-length-range": `0,${init.max_bytes}`,
        },
        body: file,
      });
      if (!put.ok) {
        setError(`Upload failed (${put.status}).`);
        return false;
      }
    } catch {
      setError("Upload network error.");
      return false;
    }

    // Step 3: finalize
    try {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: init.photo_id,
          client_id: clientId,
          appointment_id: appointmentId,
          chart_id: chartId,
          storage_path: init.storage_path,
          content_type: file.type,
          kind: "other",
          taken_at: new Date().toISOString(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Finalize failed.");
        return false;
      }
    } catch {
      setError("Finalize network error.");
      return false;
    }
    return true;
  }

  async function patchPhoto(id: string, patch: Partial<Photo>) {
    await fetch(`/api/photos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    void load();
  }

  async function deletePhoto(id: string) {
    if (!confirm("Delete this photo? This cannot be undone.")) return;
    await fetch(`/api/photos/${id}`, { method: "DELETE" });
    void load();
  }

  function startPair(id: string) {
    setPairing(id);
  }
  async function completePair(partnerId: string) {
    if (!pairing) return;
    await patchPhoto(pairing, { pair_id: partnerId });
    setPairing(null);
  }
  async function unpair(id: string) {
    await patchPhoto(id, { pair_id: null });
  }

  if (photos === null) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
        Loading photos…
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Photos
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            JPEG / PNG / WebP / HEIC, up to 25 MB. Tag as before/after to enable
            comparison view. {signed && "Chart is signed — kind + pairings are locked."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => {
              setLiveOpen((v) => !v);
              setPhoneOpen(false);
            }}
            disabled={signed}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              liveOpen
                ? "bg-[var(--color-gold)] text-[var(--color-navy-deep)]"
                : "border border-[var(--color-line)] bg-white text-[var(--color-navy)]"
            }`}
          >
            📷 {liveOpen ? "Hide camera" : "Capture from camera"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhoneOpen((v) => !v);
              setLiveOpen(false);
            }}
            disabled={signed}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              phoneOpen
                ? "bg-[var(--color-gold)] text-[var(--color-navy-deep)]"
                : "border border-[var(--color-line)] bg-white text-[var(--color-navy)]"
            }`}
          >
            📱 {phoneOpen ? "Hide phone pairing" : "Use my phone"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading !== null}
            className="rounded-lg bg-[var(--color-navy)] px-3 py-1.5 text-xs font-semibold text-[var(--color-cream)] disabled:opacity-50"
          >
            {uploading !== null ? `Uploading ${uploading}…` : "+ Upload file"}
          </button>
        </div>
      </div>

      {liveOpen && !signed && (
        <div className="mt-4">
          <LiveCaptureCamera
            clientId={clientId}
            appointmentId={appointmentId}
            chartId={chartId}
            kind="during"
            onSaved={() => void load()}
          />
        </div>
      )}

      {phoneOpen && !signed && (
        <div className="mt-4">
          <PhonePairing
            clientId={clientId}
            appointmentId={appointmentId}
            chartId={chartId}
          />
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {pairing && (
        <div className="mt-3 rounded-lg border-2 border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/10 px-3 py-2 text-xs text-[var(--color-gold-deep)]">
          Pairing mode — pick another photo to mark it as the matching pair.
          <button
            type="button"
            onClick={() => setPairing(null)}
            className="ml-3 font-semibold underline"
          >
            Cancel
          </button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--color-line)] bg-white px-4 py-8 text-center text-xs text-[var(--color-ink-muted)]">
          No photos yet. Upload to attach them to this client.
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => {
            const url = urls[p.id];
            const isPairTarget = pairing && pairing !== p.id;
            return (
              <li
                key={p.id}
                className={`group rounded-lg border bg-white shadow-sm transition ${
                  isPairTarget
                    ? "cursor-pointer border-[var(--color-gold)] hover:shadow-md"
                    : "border-[var(--color-line)]"
                }`}
                onClick={isPairTarget ? () => completePair(p.id) : undefined}
              >
                <div className="relative aspect-square overflow-hidden rounded-t-lg bg-[var(--color-cream)]">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt={p.label ?? p.kind} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-[var(--color-ink-muted)]">
                      Loading…
                    </div>
                  )}
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${KIND_ACCENT[p.kind]}`}
                  >
                    {p.kind}
                  </span>
                  {p.pair_id && (
                    <span className="absolute right-2 top-2 rounded-full bg-[var(--color-navy)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-cream)]">
                      Paired
                    </span>
                  )}
                </div>
                <div className="space-y-1 p-2 text-[11px]">
                  <div className="flex items-center gap-1">
                    <select
                      value={p.kind}
                      disabled={signed}
                      onChange={(e) => patchPhoto(p.id, { kind: e.target.value as Photo["kind"] })}
                      className="flex-1 rounded border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[10px]"
                    >
                      <option value="before">Before</option>
                      <option value="after">After</option>
                      <option value="during">During</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <input
                    placeholder="Label (e.g. forehead)"
                    defaultValue={p.label ?? ""}
                    onBlur={(e) => {
                      if (e.currentTarget.value !== (p.label ?? "")) {
                        patchPhoto(p.id, { label: e.currentTarget.value || null });
                      }
                    }}
                    className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[10px]"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {p.pair_id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setCompareIds([p.pair_id!, p.id])}
                          className="text-[10px] font-semibold text-[var(--color-teal)] hover:underline"
                        >
                          Compare
                        </button>
                        <button
                          type="button"
                          onClick={() => unpair(p.id)}
                          disabled={signed}
                          className="text-[10px] font-semibold text-[var(--color-ink-muted)] hover:underline disabled:opacity-40"
                        >
                          Unpair
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startPair(p.id)}
                        disabled={signed || pairing === p.id}
                        className="text-[10px] font-semibold text-[var(--color-gold-deep)] hover:underline disabled:opacity-40"
                      >
                        Pair…
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deletePhoto(p.id)}
                      disabled={signed && p.chart_id === chartId}
                      className="ml-auto text-[10px] font-semibold text-rose-700 hover:underline disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {compareIds && (
        <CompareModal
          ids={compareIds}
          urls={urls}
          photos={photos}
          onClose={() => setCompareIds(null)}
        />
      )}
    </section>
  );
}

function CompareModal({
  ids,
  urls,
  photos,
  onClose,
}: {
  ids: [string, string];
  urls: Record<string, string>;
  photos: Photo[];
  onClose: () => void;
}) {
  const a = photos.find((p) => p.id === ids[0]);
  const b = photos.find((p) => p.id === ids[1]);
  if (!a || !b) return null;
  // Order: before first, after second
  const [before, after] = a.kind === "before" || b.kind !== "before" ? [a, b] : [b, a];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-[var(--color-navy)]">
            Before / After comparison
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-[var(--color-ink-muted)] hover:underline"
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[before, after].map((p) => (
            <div key={p.id} className="rounded-lg border border-[var(--color-line)] bg-white p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                {p.kind} {p.taken_at && `· ${new Date(p.taken_at).toLocaleDateString()}`}
              </div>
              {urls[p.id] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={urls[p.id]}
                  alt={p.label ?? p.kind}
                  className="mt-2 w-full rounded-md object-contain"
                />
              )}
              {p.label && <p className="mt-2 text-sm text-[var(--color-ink)]">{p.label}</p>}
              {p.notes && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{p.notes}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
