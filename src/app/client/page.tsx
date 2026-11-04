import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type {
  AppointmentDoc,
  AppointmentStatus,
  ClientDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Aesthera · My account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type ClientView = {
  id: string;
  fullName: string;
  email: string;
  preferredName: string | null;
};

type Visit = {
  id: string;
  startsAt: Date | null;
  service: string;
  status: AppointmentStatus;
  isUpcoming: boolean;
};

async function loadClient(tenantId: string, email: string): Promise<ClientView | null> {
  try {
    const snap = await tenantCol(tenantId, "clients")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data() as ClientDoc;
    return {
      id: d.id,
      fullName: data.full_name,
      email: data.email,
      preferredName: data.preferred_name,
    };
  } catch (err) {
    console.error("[client-home] loadClient", err);
    return null;
  }
}

async function loadVisits(tenantId: string, clientDocId: string): Promise<Visit[]> {
  const now = Timestamp.fromDate(new Date());
  try {
    const snap = await tenantCol(tenantId, "appointments")
      .where("client_id", "==", clientDocId)
      .orderBy("starts_at", "desc")
      .limit(20)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as AppointmentDoc;
      const startsAt = toDate(data.starts_at);
      return {
        id: d.id,
        startsAt,
        service: data.service,
        status: data.status,
        isUpcoming: !!startsAt && data.starts_at >= now && data.status === "scheduled",
      };
    });
  } catch (err) {
    console.error("[client-home] loadVisits", err);
    return [];
  }
}

export default async function ClientHomePage() {
  const ctx = await requireTenantContext("tenant_client");
  const client = await loadClient(ctx.tenant.id, ctx.user.email);

  if (!client) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Welcome
        </h1>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          Your client record isn&apos;t fully set up yet. The clinic will
          finish your profile shortly. If something looks off, message
          {" "}
          <a href={`mailto:${ctx.tenant.owner_email}`} className="underline">
            {ctx.tenant.owner_email}
          </a>
          .
        </div>
      </div>
    );
  }

  const visits = await loadVisits(ctx.tenant.id, client.id);
  const next = visits.find((v) => v.isUpcoming);
  const past = visits.filter((v) => !v.isUpcoming);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Hi, {client.preferredName || client.fullName.split(" ")[0]}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your account at <strong>{ctx.tenant.name}</strong>.
      </p>

      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Next visit
        </h2>
        {next ? (
          <div className="mt-3 rounded-xl border border-[var(--color-gold)] bg-[var(--color-paper)] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold)]">
              Upcoming
            </div>
            <div className="mt-2 font-display text-xl font-bold text-[var(--color-navy)]">
              {next.service}
            </div>
            <div className="mt-1 text-sm text-[var(--color-ink-soft)]">
              {next.startsAt?.toLocaleString() ?? "—"}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded bg-[var(--color-teal)] px-3 py-1.5 text-xs font-semibold text-white">
                Reschedule
              </button>
              <button className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">
                Add to calendar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 text-sm text-[var(--color-ink-muted)]">
            No upcoming visits. Booking flow ships with the next deploy — for
            now, contact the clinic to schedule.
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Past visits
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {past.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No past visits yet.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {past.map((v) => (
                <li key={v.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-semibold text-[var(--color-ink)]">{v.service}</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      {v.startsAt?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--color-ink-soft)]">
                    {v.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
