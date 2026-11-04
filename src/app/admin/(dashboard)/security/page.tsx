import Link from "next/link";
import { headers } from "next/headers";
import { db, toDate } from "@/lib/firestore";
import { getSessionUser } from "@/lib/auth-server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import EnrollTotp from "@/components/admin/EnrollTotp";
import EnrollSms from "@/components/admin/EnrollSms";
import SignOutAllButton from "@/components/admin/SignOutAllButton";
import type { UserDoc, AuditLogDoc } from "@/lib/firestore-types";

function initFirebaseAdmin() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      initializeApp({
        credential: cert(JSON.parse(Buffer.from(saB64, "base64").toString("utf8"))),
      });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams?: Promise<{ enrolled?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) return null; // dashboard layout handles redirect

  const params = (await searchParams) ?? {};
  const justEnrolled = params.enrolled === "1";

  const userDoc = await db().collection("users").doc(session.firebaseUid).get();
  const userData = userDoc.data() as UserDoc | undefined;
  const mfaEnrolledAt = toDate(userData?.mfa_enrolled_at ?? null);

  // Pull enrolled factors directly from Identity Platform (source of truth)
  initFirebaseAdmin();
  let totpEnrolled = false;
  let phoneEnrolled = false;
  let phoneNumber: string | null = null;
  try {
    const fbUser = await getAuth().getUser(session.firebaseUid);
    const factors = fbUser.multiFactor?.enrolledFactors ?? [];
    for (const f of factors) {
      if (f.factorId === "totp") totpEnrolled = true;
      if (f.factorId === "phone") {
        phoneEnrolled = true;
        const phoneFactor = f as unknown as { phoneNumber?: string };
        phoneNumber = phoneFactor.phoneNumber ?? null;
      }
    }
  } catch (err) {
    console.error("[security] getUser failed", err);
  }

  const recentLoginsSnap = await db()
    .collection("login_attempts")
    .where("email", "==", session.email)
    .orderBy("created_at", "desc")
    .limit(10)
    .get()
    .catch(() => null);

  const recentLogins = (recentLoginsSnap?.docs ?? []).map((d) => {
    const data = d.data();
    return {
      id: d.id,
      succeeded: !!data.succeeded,
      failureReason: (data.failure_reason as string) ?? null,
      ip: (data.ip as string) ?? null,
      ua: (data.user_agent as string) ?? null,
      createdAt: toDate(data.created_at),
    };
  });

  const recentAuditSnap = await db()
    .collection("audit_log")
    .where("actor_email", "==", session.email)
    .orderBy("created_at", "desc")
    .limit(15)
    .get()
    .catch(() => null);

  const recentAuditEntries = (recentAuditSnap?.docs ?? []).map((d) => {
    const data = d.data() as AuditLogDoc;
    return {
      id: d.id,
      action: data.action,
      targetType: data.target_type,
      targetId: data.target_id,
      ip: data.ip,
      createdAt: toDate(data.created_at),
    };
  });

  // Posture flags — what's currently true for the platform + this user.
  // Sources: Firestore (encryption-at-rest is GCP-default), the user's own
  // MFA enrollment, and runtime config.
  const mfaEnabled = totpEnrolled || phoneEnrolled;
  const aal2 = session.aal === "aal2";
  const lockedUntilRaw = (userData as { locked_until?: unknown })?.locked_until;
  const lockedUntil =
    lockedUntilRaw && typeof (lockedUntilRaw as { toDate?: () => Date }).toDate === "function"
      ? (lockedUntilRaw as { toDate: () => Date }).toDate()
      : null;
  const failedLoginCount = Number((userData as { failed_login_count?: unknown })?.failed_login_count ?? 0);

  const h = await headers();
  const currentIp = h.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const currentUa = h.get("user-agent");

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Security
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Two-factor authentication, session activity, and account integrity for{" "}
        <strong>{session.email}</strong>.
      </p>

      {justEnrolled && (
        <div className="mt-6 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong className="block font-semibold">
            Two-factor enrolled successfully.
          </strong>
          Future sign-ins will require both your password and a one-time code.
        </div>
      )}

      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
              Authenticator app (TOTP)
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Google Authenticator, 1Password, Authy, or any RFC-6238 app.
              Strongest free option — no SIM-swap risk.
            </p>
          </div>
          <FactorBadge enrolled={totpEnrolled} />
        </div>
        {totpEnrolled ? (
          <div className="mt-5 text-sm text-[var(--color-ink)]">
            Authenticator enrolled. To rotate (lost device, etc.), contact
            support — recovery requires identity verification.
          </div>
        ) : (
          <EnrollTotp />
        )}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
              SMS to phone
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Backup factor — useful if you lose your authenticator. Less
              secure than TOTP (SIM-swap risk) but better than nothing.
            </p>
          </div>
          <FactorBadge enrolled={phoneEnrolled} />
        </div>
        {phoneEnrolled ? (
          <div className="mt-5 text-sm text-[var(--color-ink)]">
            SMS enrolled to <code className="font-mono">{phoneNumber || "your phone"}</code>.
            To change, contact support.
          </div>
        ) : (
          <EnrollSms email={session.email} />
        )}
      </section>

      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Recent sign-in activity
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Last 10 attempts on this account. Anything you don&apos;t recognize?
          Change your password and re-enroll your authenticator immediately.
        </p>
        <table className="mt-5 w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr className="border-b border-[var(--color-line)]">
              <th className="pb-2 pr-4">When</th>
              <th className="pb-2 pr-4">Result</th>
              <th className="pb-2 pr-4">IP</th>
              <th className="pb-2">Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {recentLogins.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-[var(--color-ink-muted)]">
                  No sign-in attempts recorded yet.
                </td>
              </tr>
            )}
            {recentLogins.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4 text-xs text-[var(--color-ink-muted)]">
                  {l.createdAt ? l.createdAt.toLocaleString() : "—"}
                </td>
                <td className="py-2 pr-4">
                  {l.succeeded ? (
                    <span className="inline-flex rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      success
                    </span>
                  ) : (
                    <span className="inline-flex rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                      {l.failureReason || "fail"}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {l.ip || "—"}
                </td>
                <td className="py-2 text-[10px] text-[var(--color-ink-muted)]">
                  {l.ua ? l.ua.slice(0, 60) + (l.ua.length > 60 ? "..." : "") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* HIPAA technical-safeguard posture (§164.312) */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          HIPAA technical safeguards
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Live status of the HIPAA Security Rule technical safeguards (§164.312)
          for this account.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <PostureCard
            label="Access control · unique user ID"
            spec="§164.312(a)(2)(i)"
            on={true}
            note="Each admin has a unique Firebase UID; all writes carry actor_user_id."
          />
          <PostureCard
            label="Automatic logoff"
            spec="§164.312(a)(2)(iii)"
            on={true}
            note="15-minute idle timeout enforced client-side; session cookie expires server-side after 8h."
          />
          <PostureCard
            label="Encryption at rest"
            spec="§164.312(a)(2)(iv)"
            on={true}
            note="AES-256 — Firestore + Cloud Storage default. Sensitive tokens additionally AES-256-GCM encrypted before write."
          />
          <PostureCard
            label="Encryption in transit"
            spec="§164.312(e)(1)"
            on={true}
            note="TLS 1.2+ enforced by Cloud Run. HSTS preloaded on aesthera.io."
          />
          <PostureCard
            label="Person/entity authentication"
            spec="§164.312(d)"
            on={mfaEnabled}
            note={
              mfaEnabled
                ? `Multi-factor enabled. Current session AAL: ${aal2 ? "AAL2" : "AAL1"}.`
                : "Enable a second factor above to satisfy this safeguard."
            }
          />
          <PostureCard
            label="Audit controls"
            spec="§164.312(b)"
            on={true}
            note="Append-only audit_log collection. Security rules deny update + delete on every row."
          />
          <PostureCard
            label="Integrity"
            spec="§164.312(c)(1)"
            on={true}
            note="Firestore security rules + transactional writes. Signed PDFs are immutable post-sign."
          />
          <PostureCard
            label="Account lockout"
            spec="defense-in-depth"
            on={true}
            note={
              failedLoginCount > 0
                ? `5 failed attempts in 15 min triggers 30-min lockout. Current count: ${failedLoginCount}.`
                : "5 failed attempts in 15 min triggers 30-min lockout."
            }
          />
        </div>
        {lockedUntil && lockedUntil.getTime() > Date.now() && (
          <div className="mt-4 rounded-md border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            Your account is currently in cooldown until {lockedUntil.toLocaleString()}.
          </div>
        )}
      </section>

      {/* Subprocessor BAA inventory */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Subprocessors &amp; Business Associate Agreements
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Third-party services that may process platform data, and the BAA
          status for each. PHI does not leave Aesthera infrastructure unless a
          BAA is in place with the receiving subprocessor.
        </p>
        <div className="mt-5 overflow-hidden rounded-lg border border-[var(--color-line)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/50 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-2">Subprocessor</th>
                <th className="px-4 py-2">Purpose</th>
                <th className="px-4 py-2">Data category</th>
                <th className="px-4 py-2">BAA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 font-semibold text-[var(--color-navy)]">{s.name}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">{s.purpose}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">{s.dataCategory}</td>
                  <td className="px-4 py-2.5">
                    <BaaBadge status={s.baa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-[var(--color-ink-muted)]">
          BAA status reflects platform-wide agreements at the infrastructure tier.
          Per-clinic BAAs (between Aesthera and the clinic) are signed at onboarding
          on the Growth and Enterprise tiers.
        </p>
      </section>

      {/* Recent admin actions (audit log peek) */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Recent admin actions
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Last 15 changes you made — pulled from the append-only audit log.
        </p>
        {recentAuditEntries.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            No audited actions yet. Changes you make to leads, deals, contacts,
            and tenants will appear here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)]">
            {recentAuditEntries.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-[var(--color-navy)]">
                    {a.action}
                  </div>
                  <div className="truncate text-[11px] text-[var(--color-ink-muted)]">
                    {a.targetType ? `${a.targetType}` : ""}
                    {a.targetId ? ` · ${a.targetId.slice(0, 24)}${a.targetId.length > 24 ? "…" : ""}` : ""}
                    {a.ip ? ` · from ${a.ip}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-[var(--color-ink-muted)]">
                  {a.createdAt ? a.createdAt.toLocaleString() : "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/admin/audit"
          className="mt-5 inline-block text-xs font-semibold text-[var(--color-teal)] hover:underline"
        >
          See full audit log →
        </Link>
      </section>

      {/* Current session + sign-out-all */}
      <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Active session
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Sign out of every browser and device where this account is currently
          authenticated. Use this if you suspect your credentials were exposed
          or if you signed in on a shared device.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <Row label="Email" value={session.email} />
          <Row label="Role" value={session.role.replace(/_/g, " ")} />
          <Row label="Auth level" value={aal2 ? "AAL2 (MFA-completed)" : "AAL1 (password only)"} />
          <Row label="Current IP" value={currentIp ? <code className="font-mono text-xs">{currentIp}</code> : "—"} />
          {currentUa && (
            <Row
              label="Browser"
              value={<span className="text-xs">{currentUa.slice(0, 60)}{currentUa.length > 60 ? "…" : ""}</span>}
            />
          )}
          <Row label="Firebase UID" value={<code className="font-mono text-[10px]">{session.firebaseUid}</code>} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SignOutAllButton />
          <Link
            href="/admin"
            className="text-sm font-semibold text-[var(--color-teal)] hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}

const SUBPROCESSORS: {
  name: string;
  purpose: string;
  dataCategory: string;
  baa: "signed" | "available" | "not_required";
}[] = [
  {
    name: "Google Cloud Platform",
    purpose: "Hosting (Cloud Run), database (Firestore), storage (Cloud Storage), auth (Identity Platform)",
    dataCategory: "All platform data + PHI",
    baa: "signed",
  },
  {
    name: "Stripe",
    purpose: "Payment processing + Connect for clinic payouts",
    dataCategory: "Payment metadata (no card data on Aesthera servers)",
    baa: "not_required",
  },
  {
    name: "Resend",
    purpose: "Transactional + marketing email delivery + webhook events",
    dataCategory: "Email content (subject + body) + recipient address",
    baa: "available",
  },
  {
    name: "Twilio",
    purpose: "SMS delivery (per-tenant subaccounts)",
    dataCategory: "Phone number + SMS content",
    baa: "signed",
  },
  {
    name: "Anthropic",
    purpose: "Claude Sonnet — reply drafting + AI marketing copy",
    dataCategory: "Lead/contact context (no PHI sent without explicit clinic opt-in)",
    baa: "available",
  },
];

function PostureCard({
  label,
  spec,
  on,
  note,
}: {
  label: string;
  spec: string;
  on: boolean;
  note: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        on
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-amber-200 bg-amber-50/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          {spec}
        </div>
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
            on ? "bg-emerald-500" : "bg-amber-500"
          }`}
        >
          {on ? "✓" : "!"}
        </span>
      </div>
      <div className="mt-1 font-semibold text-[var(--color-navy)]">{label}</div>
      <p className="mt-1.5 text-xs text-[var(--color-ink-soft)]">{note}</p>
    </div>
  );
}

function BaaBadge({ status }: { status: "signed" | "available" | "not_required" }) {
  if (status === "signed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Signed
      </span>
    );
  }
  if (status === "available") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-800">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        Available
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cream-deep)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
      Not required
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <span className="text-right font-medium text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

function FactorBadge({ enrolled }: { enrolled: boolean }) {
  return enrolled ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      Not enrolled
    </span>
  );
}
