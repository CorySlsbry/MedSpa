"use client";

import { useState } from "react";
import type { LeadStatus } from "@/lib/firestore-types";

const STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "demo_booked", label: "Demo booked" },
  { value: "demo_done", label: "Demo done" },
  { value: "founding_spot_held", label: "Founding-25 held" },
  { value: "closed_won", label: "Closed won" },
  { value: "closed_lost", label: "Closed lost" },
  { value: "no_response", label: "No response" },
];

export default function LeadActions({
  leadId,
  initialStatus,
}: {
  leadId: string;
  initialStatus: LeadStatus;
}) {
  const [status, setStatus] = useState<LeadStatus>(initialStatus);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  async function changeStatus(newStatus: LeadStatus) {
    if (newStatus === status) return;
    setSavingStatus(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        setStatus(newStatus);
        setStatusMsg("Saved.");
        setTimeout(() => setStatusMsg(null), 2000);
      } else {
        setStatusMsg(body?.error || "Update failed.");
      }
    } catch {
      setStatusMsg("Network error.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function addNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setSavingNote(true);
    setNoteMsg(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        setNoteBody("");
        setNoteMsg("Note added — refresh to see it in the timeline.");
        setTimeout(() => setNoteMsg(null), 3000);
        // Best-effort refresh to surface the new activity
        window.location.reload();
      } else {
        setNoteMsg(body?.error || "Could not add note.");
      }
    } catch {
      setNoteMsg("Network error.");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Status
        </label>
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as LeadStatus)}
          disabled={savingStatus}
          className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20 disabled:cursor-wait disabled:opacity-70"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {statusMsg && (
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{statusMsg}</p>
        )}
      </div>

      <form onSubmit={addNote} className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Add note
        </label>
        <textarea
          rows={3}
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          placeholder="What did the call cover, what's the next step…"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
        />
        <button
          type="submit"
          disabled={savingNote || !noteBody.trim()}
          className="btn btn-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingNote ? "Saving..." : "Add note"}
        </button>
        {noteMsg && (
          <p className="text-xs text-[var(--color-ink-muted)]">{noteMsg}</p>
        )}
      </form>
    </div>
  );
}
