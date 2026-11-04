"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * HIPAA §164.312(a)(2)(iii) — Automatic Logoff.
 *
 * Tracks user activity (mouse, keyboard, touch, scroll) on whatever shell
 * mounts it. After IDLE_BEFORE_WARN_MS of inactivity opens a modal warning
 * the user they'll be signed out; clicking "Stay signed in" resets the timer.
 * Doing nothing (or clicking "Sign out") forces a server-side sign-out which
 * revokes refresh tokens + clears the session cookie + redirects.
 *
 * Defaults: 14 min to warning, 1 min in-modal countdown → 15 min total
 * before forced logoff. Same policy applies across admin + tenant portals;
 * what differs is the sign-out endpoint and the redirect target, both
 * passed in by the wrapping shell (AdminIdleTimer / TenantIdleTimer).
 */
const IDLE_BEFORE_WARN_MS = 14 * 60 * 1000;
const WARN_DURATION_MS = 60 * 1000;
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

export default function IdleTimer({
  signOutEndpoint,
  redirectTo,
}: {
  signOutEndpoint: string;
  redirectTo: string;
}) {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARN_DURATION_MS / 1000);
  const lastActivityRef = useRef<number>(Date.now());
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const forceSignOut = useCallback(async () => {
    try {
      await fetch(signOutEndpoint, { method: "POST" });
    } catch {
      // Endpoint may be unreachable — fall through and redirect anyway so
      // the user isn't stuck on a stale page with revoked credentials.
    }
    window.location.href = redirectTo;
  }, [signOutEndpoint, redirectTo]);

  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarning(false);
    setSecondsLeft(WARN_DURATION_MS / 1000);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Track activity. Listeners are passive + capture so they fire reliably
  // even if a child component stops propagation. We only update the ref so
  // this doesn't re-render on every mouse-move.
  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      // If the warning modal is showing and the user does anything, dismiss
      // it. (The modal still has explicit Stay/Sign-out buttons for clarity.)
      setWarning((w) => {
        if (w) {
          setSecondsLeft(WARN_DURATION_MS / 1000);
          return false;
        }
        return w;
      });
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true, capture: true });
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity, { capture: true });
      }
    };
  }, []);

  // Idle check loop — runs every 5 sec, opens warning when threshold hit.
  useEffect(() => {
    checkIntervalRef.current = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_BEFORE_WARN_MS) {
        setWarning((w) => {
          if (w) return w; // already shown — countdown handles forced logout
          setSecondsLeft(WARN_DURATION_MS / 1000);
          return true;
        });
      }
    }, 5000);
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, []);

  // Countdown effect — runs only while warning modal is open. When seconds
  // hit 0, force a server-side sign-out.
  useEffect(() => {
    if (!warning) return;
    countdownRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          void forceSignOut();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [warning, forceSignOut]);

  if (!warning) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-timer-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-[var(--color-paper)] p-6 shadow-2xl">
        <h2
          id="idle-timer-title"
          className="font-display text-lg font-bold text-[var(--color-navy)]"
        >
          Are you still there?
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          For your security and HIPAA compliance, you&apos;ll be signed out in{" "}
          <strong className="font-bold tabular-nums text-[var(--color-navy)]">
            {secondsLeft}s
          </strong>{" "}
          due to inactivity.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={stayActive}
            className="btn btn-gold flex-1 justify-center"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={() => void forceSignOut()}
            className="btn btn-ghost flex-1 justify-center"
          >
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
