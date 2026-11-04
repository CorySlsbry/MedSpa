"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InboxClientOption } from "@/app/owner/inbox/page";

type ConversationListItem = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_phone: string;
  last_message_at: string | null;
  last_message_preview: string;
  last_direction: "inbound" | "outbound";
  unread_count: number;
  archived_at: string | null;
};

type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  from_number: string;
  to_number: string;
  status: string;
  actor_email: string | null;
  created_at: string | null;
};

export default function InboxView({
  clients,
  smsAvailable,
}: {
  clients: InboxClientOption[];
  smsAvailable: boolean;
}) {
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Load conversations list
  useEffect(() => {
    let alive = true;
    setLoadingList(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/owner/conversations?archived=${filter === "archived"}`,
        );
        const body = await res.json();
        if (!alive) return;
        if (res.ok) setConversations(body.conversations || []);
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [filter]);

  // Auto-pick the first conversation when loaded
  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  // Load thread when active conversation changes
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    setLoadingThread(true);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/owner/conversations/${activeId}/messages`);
        const body = await res.json();
        if (!alive) return;
        if (res.ok) {
          setThread(body.messages || []);
          // Mark as read (best-effort)
          if (body.conversation?.unread_count > 0) {
            await fetch(`/api/owner/conversations/${activeId}/read`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            }).catch(() => {});
            setConversations((prev) =>
              prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c)),
            );
          }
        }
      } finally {
        if (alive) setLoadingThread(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeId]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );

  async function send() {
    if (!activeId || !draft.trim() || !smsAvailable) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/owner/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error || "Could not send.");
        setSending(false);
        return;
      }
      // Optimistically push the message into the thread
      setThread((prev) => [
        ...prev,
        {
          id: body.sid ?? `temp-${Date.now()}`,
          direction: "outbound",
          body: draft.trim(),
          from_number: "",
          to_number: active?.client_phone ?? "",
          status: "sent",
          actor_email: null,
          created_at: new Date().toISOString(),
        },
      ]);
      // Bump conversation summary
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                last_message_preview:
                  draft.length > 117 ? draft.slice(0, 117) + "…" : draft,
                last_direction: "outbound",
                last_message_at: new Date().toISOString(),
              }
            : c,
        ),
      );
      setDraft("");
    } catch {
      setErr("Network error.");
    } finally {
      setSending(false);
    }
  }

  async function archive() {
    if (!activeId) return;
    await fetch(`/api/owner/conversations/${activeId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: true }),
    }).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== activeId));
    setActiveId(null);
    setThread([]);
  }

  return (
    <div className="grid h-[calc(100vh-220px)] grid-cols-1 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-sm md:grid-cols-[320px_1fr]">
      {/* Conversation list */}
      <aside className="flex flex-col border-b border-[var(--color-line)] md:border-b-0 md:border-r">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-4 py-3">
          <div className="flex gap-1">
            {(["active", "archived"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setActiveId(null);
                }}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  filter === f
                    ? "bg-[var(--color-navy)] text-[var(--color-cream)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-cream)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-[var(--color-gold)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-navy-deep)] hover:bg-[var(--color-gold-deep)] hover:text-white"
          >
            + New
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--color-ink-muted)]">
              Loading…
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--color-ink-muted)]">
              {filter === "archived"
                ? "Nothing archived."
                : "No conversations yet. Inbound replies from clients will appear here."}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {conversations.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      className={`block w-full px-4 py-3 text-left transition ${
                        isActive
                          ? "bg-[var(--color-gold)]/10"
                          : "hover:bg-[var(--color-cream-deep)]/30"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold text-[var(--color-navy)]">
                          {c.client_name ?? c.client_phone}
                        </span>
                        {c.last_message_at && (
                          <span className="shrink-0 text-[10px] text-[var(--color-ink-muted)]">
                            {timeAgo(c.last_message_at)}
                          </span>
                        )}
                      </div>
                      {!c.client_name && (
                        <div className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                          {c.client_phone}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`shrink-0 text-[10px] font-bold uppercase ${
                            c.last_direction === "inbound"
                              ? "text-[var(--color-teal-deep)]"
                              : "text-[var(--color-ink-muted)]"
                          }`}
                        >
                          {c.last_direction === "inbound" ? "← In" : "→ Out"}
                        </span>
                        <span className="truncate text-xs text-[var(--color-ink-soft)]">
                          {c.last_message_preview}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="shrink-0 rounded-full bg-[var(--color-gold)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-navy-deep)]">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-ink-muted)]">
            Pick a conversation to view messages, or start a new one.
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-5 py-3">
              <div>
                <div className="font-display text-base font-bold text-[var(--color-navy)]">
                  {active.client_name ?? "Unknown client"}
                </div>
                <div className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {active.client_phone}
                </div>
              </div>
              <button
                type="button"
                onClick={archive}
                className="rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              >
                {filter === "archived" ? "Restore" : "Archive"}
              </button>
            </header>

            <ThreadView messages={thread} loading={loadingThread} />

            <footer className="border-t border-[var(--color-line)] bg-white p-3">
              {err && (
                <div className="mb-2 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {err}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Type a reply… (Cmd+Enter to send)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || sending || !smsAvailable}
                  className="rounded-lg bg-[var(--color-navy)] px-4 py-2.5 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-ink-muted)]">
                <span>{draft.length}/1500 chars</span>
                <span>STOP-compliant · Twilio</span>
              </div>
            </footer>
          </>
        )}
      </section>

      {showNew && (
        <NewConversationModal
          clients={clients}
          onClose={() => setShowNew(false)}
          onCreated={(conversationId) => {
            setShowNew(false);
            setFilter("active");
            setActiveId(conversationId);
          }}
        />
      )}
    </div>
  );
}

function ThreadView({
  messages,
  loading,
}: {
  messages: ThreadMessage[];
  loading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-ink-muted)]">
        Loading thread…
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-ink-muted)]">
        No messages yet.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
              m.direction === "outbound"
                ? "bg-[var(--color-navy)] text-[var(--color-cream)]"
                : "bg-[var(--color-cream-deep)] text-[var(--color-ink)]"
            }`}
          >
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
            {m.created_at && (
              <div
                className={`mt-1 text-[10px] ${
                  m.direction === "outbound"
                    ? "text-[var(--color-cream)]/60"
                    : "text-[var(--color-ink-muted)]"
                }`}
              >
                {new Date(m.created_at).toLocaleString()}
                {m.direction === "outbound" && m.actor_email
                  ? ` · ${m.actor_email}`
                  : ""}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewConversationModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: InboxClientOption[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSubmitting(true);
    setErr(null);
    const clientId = String(fd.get("client_id") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!clientId) {
      setErr("Pick a client.");
      setSubmitting(false);
      return;
    }
    if (!body) {
      setErr("Type a message.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/conversations/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, body }),
      });
      const json = await res.json();
      if (!res.ok || !json.conversation_id) {
        setErr(json?.error || "Could not start conversation.");
        setSubmitting(false);
        return;
      }
      onCreated(json.conversation_id);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

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
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
            New conversation
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
            Close
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Client
            </span>
            <select
              name="client_id"
              required
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            >
              <option value="">— Select client —</option>
              {clients
                .filter((c) => c.phone)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Message
            </span>
            <textarea
              name="body"
              rows={4}
              placeholder="Hi — just checking in about your visit…"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
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
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-gold disabled:opacity-70"
            >
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
