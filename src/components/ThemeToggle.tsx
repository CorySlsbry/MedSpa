"use client";

import { useEffect, useState } from "react";

/**
 * Theme switcher between the default Aesthera palette and an Apple-style
 * liquid-glass UI. Persists the preference in localStorage under a per-scope
 * key (`aesthera-theme-admin` vs `aesthera-theme-tenant`) so the admin's
 * choice doesn't leak into a tenant session opened in another tab and vice
 * versa.
 *
 * Glass styling lives in globals.css under `[data-theme="glass"]
 * .aesthera-shell` — only shells that include the `aesthera-shell` class
 * react to the attribute, so marketing pages stay on brand even if the user
 * toggled glass on the admin side and then navigated cross-page.
 */
type Theme = "aesthera" | "glass";

export default function ThemeToggle({ scope }: { scope: "admin" | "tenant" }) {
  const storageKey = `aesthera-theme-${scope}`;
  const [theme, setTheme] = useState<Theme>("aesthera");
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage / current attribute on mount. Pre-paint script
  // already set the document attribute before this component mounted, so
  // the toggle's initial state matches what the user is actually seeing.
  useEffect(() => {
    const fromAttr = document.documentElement.getAttribute("data-theme");
    if (fromAttr === "glass" || fromAttr === "aesthera") {
      setTheme(fromAttr);
    } else {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === "glass" || stored === "aesthera") {
          setTheme(stored);
          document.documentElement.setAttribute("data-theme", stored);
        }
      } catch {
        /* localStorage may be blocked; fall through to default */
      }
    }
    setMounted(true);
  }, [storageKey]);

  function applyTheme(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* no-op if localStorage blocked */
    }
  }

  function handleToggle() {
    applyTheme(theme === "glass" ? "aesthera" : "glass");
  }

  // Render a stable shell during SSR + first paint to avoid hydration
  // mismatch — the actual icon swaps in once we know the real theme.
  const isGlass = mounted && theme === "glass";

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isGlass}
      aria-label={`Switch to ${isGlass ? "Aesthera" : "Glass"} theme`}
      title={`Switch to ${isGlass ? "Aesthera" : "Glass"} theme`}
      className="flex w-full items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)] transition hover:border-[var(--color-gold)] hover:text-[var(--color-navy)]"
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-7 items-center rounded-full transition ${
          isGlass ? "bg-[var(--color-teal)] justify-end" : "bg-[var(--color-line)] justify-start"
        }`}
      >
        <span className="mx-0.5 h-3 w-3 rounded-full bg-white shadow" />
      </span>
      <span className="flex-1 text-left">{isGlass ? "Glass UI" : "Aesthera UI"}</span>
    </button>
  );
}
