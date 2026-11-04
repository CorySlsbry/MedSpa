import Link from "next/link";

/**
 * Honest, shippable scaffold for a tenant role's menu items that don't
 * yet have a deeply-built page. Replaces the 404 a user would otherwise
 * hit by rendering:
 *   - the section title + role label
 *   - a one-paragraph description of what this section does
 *   - a deep-link to the equivalent owner-portal page (which DOES have
 *     full functionality today) when one exists
 *   - a clear note that we're building the role-specific view next
 *
 * Use this for any nav item where the owner-side equivalent already
 * works. As we build dedicated role-tailored views, swap them in and
 * delete the stub.
 */
export default function LayerSectionStub({
  title,
  role,
  description,
  ownerEquivalentHref,
  ownerEquivalentLabel,
}: {
  title: string;
  role: string;
  description: string;
  ownerEquivalentHref?: string;
  ownerEquivalentLabel?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        {role} portal
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{description}</p>

      <div className="mt-8 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
          Building this out next
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          The {role.toLowerCase()}-tailored view is on the build list — same data,
          scoped to the actions {role.toLowerCase()}s should be able to take. For
          now, this section is a stub so the navigation works end-to-end.
        </p>
        {ownerEquivalentHref && ownerEquivalentLabel && (
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            If you need to act on this data right now, the owner can do it from{" "}
            <Link
              href={ownerEquivalentHref}
              className="font-semibold text-[var(--color-teal)] hover:underline"
            >
              {ownerEquivalentLabel}
            </Link>
            .
          </p>
        )}
      </div>

      <div className="mt-6 text-xs text-[var(--color-ink-muted)]">
        Have a specific {role.toLowerCase()} workflow you want here first? Click{" "}
        <strong>Ask Aesthera</strong> in the bottom-right and tell the assistant
        — that helps us prioritize.
      </div>
    </div>
  );
}
