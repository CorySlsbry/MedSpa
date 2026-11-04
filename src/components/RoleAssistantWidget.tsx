"use client";

import { useEffect, useRef, useState } from "react";

type Role =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk";

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallSummary[] };

type ToolCallSummary = {
  name: string;
  input: Record<string, unknown>;
  result: { ok: boolean; data?: unknown; error?: string };
};

const ROLE_LABEL: Record<Role, string> = {
  tenant_owner: "Owner AI",
  tenant_manager: "Manager AI",
  tenant_provider: "Provider AI",
  tenant_front_desk: "Front Desk AI",
};

const ROLE_TAGLINE: Record<Role, string> = {
  tenant_owner: "Sonnet 4.6 · clinic-wide",
  tenant_manager: "Sonnet 4.6 · operations",
  tenant_provider: "Sonnet 4.6 · clinical-aware",
  tenant_front_desk: "Sonnet 4.6 · concierge",
};

const SUGGESTED_PROMPTS: Record<Role, string[]> = {
  tenant_owner: [
    "Who hasn't been in for 90 days?",
    "What's on the calendar tomorrow?",
    "How's revenue this week?",
    "Draft a 21-day Botox follow-up",
  ],
  tenant_manager: [
    "Which providers had the most no-shows this month?",
    "How's our capacity utilization?",
    "Any complaints to triage?",
    "Show me low-stock items",
  ],
  tenant_provider: [
    "Who's on my schedule today?",
    "Pull up my next client's history",
    "Draft a 21-day check-in for my morning patient",
    "Last visit notes for [client name]",
  ],
  tenant_front_desk: [
    "Who's checking in today?",
    "Find Sarah Smith's last visit",
    "Draft a friendly rebook note",
    "Next available 30-min slot tomorrow",
  ],
};

const ROLE_OPENER: Record<Role, string> = {
  tenant_owner:
    "Hi! I can look up clients, check your calendar, summarize your numbers, and draft messages. Try one of these:",
  tenant_manager:
    "Hi! I can pull operational stats, surface complaint patterns, check team coverage, and draft client replies. Try one of these:",
  tenant_provider:
    "Hi! I can summarize a client's history, find their prior visits, and draft post-visit messages. Clinical decisions stay with you. Try one of these:",
  tenant_front_desk:
    "Hi! I'm your front-desk concierge. I can find clients, check today's schedule, and draft warm replies. Try one of these:",
};

/**
 * Floating AI assistant — same widget, different role-aware copy. The
 * actual prompt + tool set per role is server-side; the UI just labels
 * the experience and suggests prompts that match what the user can
 * actually do. Posts to /api/tenant/assistant which reads the role from
 * the session.
 */
export default function RoleAssistantWidget({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setPending(true);
    try {
      const res = await fetch("/api/tenant/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.error === "quota_exceeded") {
          setError(
            body.message ?? "You've hit this month's AI assistant limit. Counters reset on the 1st.",
          );
        } else {
          setError(
            body?.error ?? "The assistant didn't respond. Try again in a moment.",
          );
        }
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: body.reply ?? "",
          tool_calls: Array.isArray(body.tool_calls) ? body.tool_calls : [],
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? "Network error — check your connection and try again."
          : "Something went wrong.",
      );
    } finally {
      setPending(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  const label = ROLE_LABEL[role];
  const tagline = ROLE_TAGLINE[role];
  const prompts = SUGGESTED_PROMPTS[role];
  const opener = ROLE_OPENER[role];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${label}`}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[var(--color-navy)] px-4 py-2.5 text-sm font-semibold text-[var(--color-cream)] shadow-[0_10px_30px_-8px_rgba(27,38,54,0.4)] transition hover:bg-[var(--color-navy-deep)]"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-gold)] text-[10px] font-bold text-[var(--color-navy-deep)]">
            AI
          </span>
          Ask Aesthera
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[640px] max-h-[calc(100vh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-navy)] text-[10px] font-bold text-[var(--color-gold)]">
                AI
              </span>
              <div>
                <div className="text-sm font-bold text-[var(--color-navy)]">
                  {label}
                </div>
                <div className="text-[10px] text-[var(--color-ink-muted)]">
                  {tagline}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearChat}
                aria-label="Clear conversation"
                title="Clear"
                className="rounded px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-cream-deep)]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="rounded px-2 py-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-cream-deep)]"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-[var(--color-ink-soft)]">{opener}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void send(p)}
                      className="rounded-full border border-[var(--color-line)] bg-[var(--color-cream-deep)] px-3 py-1 text-[11px] font-medium text-[var(--color-navy)] hover:bg-[var(--color-cream)]"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-[10px] text-[var(--color-ink-muted)]">
                  I read your clinic data scoped to your role. Drafts are
                  reviewed by you before anything sends. Each turn counts
                  against your monthly AI allowance — see Billing.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] ${m.role === "user" ? "ml-auto" : "mr-auto"}`}
              >
                <div
                  className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-[var(--color-navy)] text-[var(--color-cream)]"
                      : "border border-[var(--color-line)] bg-[var(--color-cream-deep)]/60 text-[var(--color-ink)]"
                  }`}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0 && (
                  <details className="mt-1 text-[10px] text-[var(--color-ink-muted)]">
                    <summary className="cursor-pointer hover:text-[var(--color-navy)]">
                      {m.tool_calls.length} data lookup
                      {m.tool_calls.length === 1 ? "" : "s"} used
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {m.tool_calls.map((tc, idx) => (
                        <li key={idx}>
                          <code className="font-mono">{tc.name}</code>
                          {tc.result.ok ? " ✓" : " ✗"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {pending && (
              <div className="mr-auto max-w-[88%] rounded-2xl border border-[var(--color-line)] bg-[var(--color-cream-deep)]/60 px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                <span className="inline-block animate-pulse">Thinking…</span>
              </div>
            )}
            {error && (
              <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {error}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-[var(--color-line)] p-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="Ask anything…"
                disabled={pending}
                className="flex-1 resize-none rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-navy)] text-[var(--color-cream)] disabled:opacity-40"
                aria-label="Send"
              >
                ↑
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
