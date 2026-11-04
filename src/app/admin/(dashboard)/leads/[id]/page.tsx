import Link from "next/link";
import { notFound } from "next/navigation";
import { db, toDate } from "@/lib/firestore";
import type {
  LeadStatus,
  LeadInterest,
  LeadDoc,
  ActivityDoc,
} from "@/lib/firestore-types";
import LeadActions from "@/components/admin/LeadActions";
import LeadOutreach from "@/components/admin/LeadOutreach";

export const dynamic = "force-dynamic";

type LeadDetail = {
  id: string;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  contactRole: string | null;
  clinicName: string | null;
  clinicType: string | null;
  locationsCount: string | null;
  interest: LeadInterest;
  status: LeadStatus;
  source: string;
  notes: string | null;
  rawPayload: unknown;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date | null;
};

type ActivityRow = {
  id: string;
  type: string;
  summary: string;
  occurredAt: Date | null;
};

async function loadActivities(leadId: string): Promise<ActivityRow[]> {
  try {
    const snap = await db()
      .collection("activities")
      .where("lead_id", "==", leadId)
      .orderBy("occurred_at", "desc")
      .limit(50)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as ActivityDoc;
      return {
        id: d.id,
        type: data.type,
        summary: data.summary,
        occurredAt: toDate(data.occurred_at),
      };
    });
  } catch (err) {
    console.error("[lead-detail] activities query failed", err);
    return [];
  }
}

async function loadLead(id: string): Promise<LeadDetail | null> {
  const snap = await db().collection("leads").doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as LeadDoc;
  return {
    id: snap.id,
    contactName: data.contact?.full_name ?? null,
    contactEmail: data.contact?.email ?? "",
    contactPhone: data.contact?.phone ?? null,
    contactRole: data.contact?.role ?? null,
    clinicName: data.company?.name ?? null,
    clinicType: data.company?.type ?? null,
    locationsCount: data.company?.locations_count ?? null,
    interest: data.interest,
    status: data.status,
    source: data.source,
    notes: data.notes,
    rawPayload: data.raw_payload,
    utmSource: data.utm_source,
    utmMedium: data.utm_medium,
    utmCampaign: data.utm_campaign,
    ip: data.ip,
    userAgent: data.user_agent,
    createdAt: toDate(data.created_at),
  };
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let lead: LeadDetail | null;
  try {
    lead = await loadLead(id);
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Firestore error loading lead: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }
  if (!lead) notFound();
  const activities = await loadActivities(lead.id);

  return (
    <div>
      <Link
        href="/admin/leads"
        className="text-sm text-[var(--color-teal)] hover:underline"
      >
        ← All leads
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {lead.clinicName || "Untitled clinic"}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Lead created {lead.createdAt?.toLocaleString() ?? "—"} · ID {lead.id}
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <div className="md:col-span-1 space-y-5">
          <Section title="Actions">
            <LeadActions leadId={lead.id} initialStatus={lead.status} />
          </Section>
          <Section title="Outreach workflow">
            <LeadOutreach leadId={lead.id} />
          </Section>
        </div>
        <div className="space-y-5 md:col-span-2">
          <Section title="Activity timeline">
            {activities.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                No activity yet. Status changes and notes will appear here.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-[var(--color-line)] pl-4">
                {activities.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-[var(--color-paper)] bg-[var(--color-gold)]" />
                    <div className="font-medium text-[var(--color-ink)]">
                      {a.summary}
                    </div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      {a.type.replace(/_/g, " ")}
                      {a.occurredAt ? ` · ${a.occurredAt.toLocaleString()}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Section title="Contact">
          <Row label="Name" value={lead.contactName} />
          <Row label="Email" value={<a href={`mailto:${lead.contactEmail}`} className="text-[var(--color-teal)] hover:underline">{lead.contactEmail}</a>} />
          <Row label="Phone" value={lead.contactPhone ? <a href={`tel:${lead.contactPhone}`} className="text-[var(--color-teal)] hover:underline">{lead.contactPhone}</a> : "—"} />
          <Row label="Role" value={lead.contactRole || "—"} />
        </Section>

        <Section title="Clinic">
          <Row label="Name" value={lead.clinicName || "—"} />
          <Row label="Type" value={lead.clinicType || "—"} />
          <Row label="Locations" value={lead.locationsCount || "—"} />
        </Section>

        <Section title="Lead">
          <Row label="Interest" value={lead.interest === "early_access" ? "🔥 Founding-25" : lead.interest} />
          <Row label="Status" value={lead.status.replace(/_/g, " ")} />
          <Row label="Source" value={lead.source} />
        </Section>

        <Section title="Attribution">
          <Row label="UTM source" value={lead.utmSource || "—"} />
          <Row label="UTM medium" value={lead.utmMedium || "—"} />
          <Row label="UTM campaign" value={lead.utmCampaign || "—"} />
          <Row label="IP" value={lead.ip || "—"} />
        </Section>
      </div>

      {lead.notes && (
        <Section title="Notes from form" className="mt-5">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-ink)]">{lead.notes}</p>
        </Section>
      )}

      <Section title="Raw payload" className="mt-5">
        <pre className="overflow-x-auto rounded bg-[var(--color-cream-deep)] p-3 text-xs text-[var(--color-ink-soft)]">
          {JSON.stringify(lead.rawPayload, null, 2)}
        </pre>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 ${className ?? ""}`}
    >
      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {title}
      </h2>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <span className="text-right font-medium text-[var(--color-ink)]">{value}</span>
    </div>
  );
}
