"use client";

/**
 * Marketing analytics tracker — public, anonymous, lightweight.
 *
 * Fires four event types to /api/analytics/event:
 *   - view              on mount (one per page load)
 *   - scroll_25/50/75/100 first time the user passes each threshold (per session)
 *   - click             when a user clicks any element with [data-cta]
 *   - signup            fired by the demo form's onSuccess (separate from this)
 *
 * No PII is collected. Session ID is a random string in sessionStorage so we
 * can dedupe views and compute unique-session counts without a cookie.
 *
 * Drop-in: render once in the marketing layout. The component renders nothing.
 */

import { useEffect } from "react";

const SESSION_KEY = "aesthera_session_id";
const SCROLL_FIRED = new Set<number>();

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function send(type: string, label: string | null = null) {
  try {
    const payload = JSON.stringify({
      type,
      label,
      path: window.location.pathname,
      session_id: getOrCreateSessionId(),
      ts: Date.now(),
      ref: document.referrer || null,
    });
    // navigator.sendBeacon is fire-and-forget, survives page unload
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/event", blob);
    } else {
      void fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never break the page over analytics
  }
}

export default function AnalyticsTracker() {
  useEffect(() => {
    // Page view
    send("view");

    // Scroll depth thresholds
    function onScroll() {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      const pct = (window.scrollY / total) * 100;
      for (const threshold of [25, 50, 75, 100]) {
        if (pct >= threshold && !SCROLL_FIRED.has(threshold)) {
          SCROLL_FIRED.add(threshold);
          send(`scroll_${threshold}`);
        }
      }
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // CTA click delegation — any element with [data-cta] anywhere on the page.
    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("[data-cta]");
      if (!target) return;
      const label = target.getAttribute("data-cta") || target.textContent?.trim().slice(0, 60) || null;
      send("click", label);
    }
    document.addEventListener("click", onClick, true);

    // Form submission tracking — DemoRequestForm posts the same event server-side
    // via the Cory-notify path, but we also emit a client-side signup intent so
    // we can attribute it to the session in the funnel.
    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement;
      if (form?.tagName === "FORM" && form.querySelector('input[name="email"]')) {
        const interest = (form.querySelector('input[name="interest"]:checked') as HTMLInputElement | null)?.value || null;
        send("signup", interest);
      }
    }
    document.addEventListener("submit", onSubmit, true);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
