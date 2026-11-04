"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

type Reply = {
  ok: boolean;
  assistant_message?: string;
  recommended_service_id?: string | null;
  ask_followup?: string | null;
  error?: string;
};

export default function ConciergeChat({
  slug,
  accent,
  tenantName,
  servicesById,
  onPickService,
  onClose,
}: {
  slug: string;
  accent: string;
  tenantName: string;
  servicesById: Record<string, { name: string; category: string; duration_minutes: number }>;
  onPickService: (serviceId: string) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hi — I'm the booking concierge for ${tenantName}. Tell me what brings you in (a concern, a goal, or a service you're curious about) and I'll help you find the right fit.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setRecommendedId(null);
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/embed/${slug}/concierge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = (await res.json()) as Reply;
      if (!res.ok || !body.ok) {
        setError(body.error || "The concierge stumbled — try rephrasing.");
        return;
      }
      const assistantMessage = body.assistant_message || "I'm not sure how to answer that — could you rephrase?";
      setMessages((curr) => [...curr, { role: "assistant", content: assistantMessage }]);
      if (body.recommended_service_id && servicesById[body.recommended_service_id]) {
        setRecommendedId(body.recommended_service_id);
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const recommended = recommendedId ? servicesById[recommendedId] : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[600px] sm:rounded-2xl">
        {/* Header */}
        <header
          className="flex items-center justify-between px-5 py-3 text-white"
          style={{ backgroundColor: accent }}
        >
          <div className="flex items-center gap-2">
            <SparkleIcon />
            <div className="text-sm font-semibold">Booking concierge</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close concierge"
            className="text-white/80 transition hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} accent={accent} />
          ))}
          {busy && (
            <div className="flex">
              <div className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
                <Dots />
              </div>
            </div>
          )}
          {recommended && recommendedId && (
            <div className="rounded-xl border-2 px-4 py-3" style={{ borderColor: accent, backgroundColor: `${accent}10` }}>
              <div className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
                Recommended
              </div>
              <div className="mt-1 font-semibold text-gray-900">{recommended.name}</div>
              <div className="text-xs text-gray-600">
                {recommended.category.replace(/_/g, " ")} · {recommended.duration_minutes} min
              </div>
              <button
                type="button"
                onClick={() => onPickService(recommendedId)}
                className="mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                Use this service →
              </button>
            </div>
          )}
          {error && (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
          )}
        </div>

        {/* Input */}
        <form
          className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me what you're hoping to address…"
            className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
        <div className="border-t border-gray-100 bg-white px-4 pb-2 pt-1 text-center text-[10px] text-gray-400">
          AI concierge — final recommendations confirmed by the provider.
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content, accent }: { role: "user" | "assistant"; content: string; accent: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2 text-sm text-white"
          style={{ backgroundColor: accent }}
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2 text-sm text-gray-800 shadow-sm">
        {content}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:300ms]" />
    </span>
  );
}

function SparkleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm6 12l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7zM6 14l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7z" />
    </svg>
  );
}
