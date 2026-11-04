/**
 * Integration trust strip — shows "plays well with" logos for the
 * services Aesthera connects to. Pure SVG / wordmarks, no external
 * brand assets fetched. Each tile is a small uniform card.
 */

const INTEGRATIONS: { name: string; mark: string; sub?: string }[] = [
  { name: "Stripe", mark: "Stripe", sub: "Connect + subscriptions" },
  { name: "Twilio", mark: "Twilio", sub: "SMS · subaccounts" },
  { name: "Resend", mark: "Resend", sub: "Transactional email" },
  { name: "Google", mark: "Google", sub: "Reviews · Calendar · OAuth" },
  { name: "Meta", mark: "Meta", sub: "Instagram · Facebook" },
  { name: "TikTok", mark: "TikTok", sub: "Posts + ads" },
  { name: "X", mark: "X", sub: "Posts" },
  { name: "Slack", mark: "Slack", sub: "Internal alerts" },
];

export default function IntegrationStrip() {
  return (
    <div className="container-narrow">
      <div className="mx-auto max-w-2xl text-center">
        <div className="tag mx-auto justify-center">Lives in your stack</div>
        <h2 className="mt-5">Plugs into the tools you already pay for.</h2>
        <p className="mx-auto mt-5 text-[var(--color-ink-soft)]">
          Aesthera doesn&apos;t replace your payments processor or your social channels — it routes them. Existing relationships, existing data, no migration drama.
        </p>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {INTEGRATIONS.map((i) => (
          <div
            key={i.name}
            className="group flex flex-col items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-5 text-center transition hover:-translate-y-1 hover:border-[var(--color-gold)]/40 hover:shadow-md"
          >
            <div className="font-display text-sm font-bold tracking-tight text-[var(--color-navy)]">{i.mark}</div>
            {i.sub && (
              <div className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-ink-muted)]">{i.sub}</div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 text-center text-xs text-[var(--color-ink-muted)]">
        And anything else with a webhook — we have a webhook signer + REST API on Growth+.
      </div>
    </div>
  );
}
