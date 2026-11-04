import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import MarketingView from "@/components/owner/MarketingView";
import CampaignManager from "@/components/owner/CampaignManager";
import ChannelsCard from "@/components/owner/ChannelsCard";
import type {
  CampaignRunDoc,
  CampaignRunStatus,
  CampaignTriggerType,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Marketing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type RecentRun = {
  id: string;
  trigger: CampaignTriggerType;
  clientEmail: string;
  subject: string | null;
  status: CampaignRunStatus;
  createdAt: Date | null;
  sentByEmail: string | null;
};

async function loadRecentRuns(tenantId: string): Promise<RecentRun[]> {
  try {
    const snap = await tenantCol(tenantId, "campaign_runs")
      .orderBy("created_at", "desc")
      .limit(50)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as CampaignRunDoc;
      return {
        id: d.id,
        trigger: data.trigger,
        clientEmail: data.client_email,
        subject: data.subject,
        status: data.status,
        createdAt: toDate(data.created_at),
        sentByEmail: data.sent_by_email,
      };
    });
  } catch (err) {
    console.error("[marketing-page] runs query", err);
    return [];
  }
}

export default async function MarketingPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const recent = await loadRecentRuns(ctx.tenant.id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Marketing
        </h1>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        AI-personalized email campaigns. Pick a trigger, review the
        candidates, write a quick brief, and send. Vertex AI Gemini drafts
        each email per client.
      </p>

      <div className="mt-6 space-y-8">
        <ChannelsCard />
        <CampaignManager />
        <MarketingView tenantName={ctx.tenant.name} recent={recent} />
      </div>
    </div>
  );
}
