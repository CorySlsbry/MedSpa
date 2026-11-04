import Link from "next/link";
import { friendlyError, type FriendlyError } from "@/lib/friendly-errors";

/**
 * Drop-in replacement for ad-hoc error banners across owner/provider/client
 * pages. Pass either a raw error (string / Error / unknown) and we'll
 * translate it via `friendlyError`, OR a pre-built FriendlyError if you
 * already have a structured one.
 *
 * Visual: left-border accent + headline + small fix line + optional
 * action button. Severity colors: info (sky), warning (amber), error
 * (rose). Defaults to warning.
 */
export default function FriendlyErrorBanner({
  error,
  ctx,
  className,
}: {
  error: unknown | FriendlyError;
  /** Action verb for the generic fallback ("Saving the appointment", etc). */
  ctx?: string;
  className?: string;
}) {
  const fe: FriendlyError =
    isFriendly(error) ? error : friendlyError(error, ctx);
  const sev = fe.severity ?? "warning";
  const palette =
    sev === "error"
      ? "border-rose-500 bg-rose-50 text-rose-900"
      : sev === "info"
        ? "border-sky-500 bg-sky-50 text-sky-900"
        : "border-amber-500 bg-amber-50 text-amber-900";

  return (
    <div
      role="alert"
      className={`rounded-lg border-l-4 ${palette} px-4 py-3 ${className ?? ""}`}
    >
      <div className="font-semibold">{fe.headline}</div>
      <div className="mt-1 text-sm opacity-90">{fe.fix}</div>
      {fe.actionHref && fe.actionLabel && (
        <div className="mt-3">
          <Link
            href={fe.actionHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-1.5 text-xs font-semibold transition hover:bg-white/40"
          >
            {fe.actionLabel} →
          </Link>
        </div>
      )}
    </div>
  );
}

function isFriendly(x: unknown): x is FriendlyError {
  return (
    typeof x === "object" &&
    x !== null &&
    "headline" in x &&
    "fix" in x &&
    typeof (x as FriendlyError).headline === "string" &&
    typeof (x as FriendlyError).fix === "string"
  );
}
