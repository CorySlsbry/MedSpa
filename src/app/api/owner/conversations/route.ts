/**
 * GET /api/owner/conversations
 *
 * Lists conversations for the inbox view. Sorted by last_message_at desc.
 * Optional ?archived=true to view the archive.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type { ClientDoc, ConversationDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INBOX_ROLES = ["tenant_owner", "tenant_manager", "tenant_front_desk"] as const;

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!INBOX_ROLES.includes(ctx.user.role as (typeof INBOX_ROLES)[number])) {
    return NextResponse.json({ error: "Inbox is owner / manager / front-desk only." }, { status: 403 });
  }

  const url = new URL(req.url);
  const showArchived = url.searchParams.get("archived") === "true";

  const snap = await tenantCol(ctx.tenant.id, "conversations")
    .orderBy("last_message_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, conversations: [] });

  // Resolve client names in one pass
  const clientIds = new Set<string>();
  for (const d of snap.docs) {
    const c = d.data() as ConversationDoc;
    if (c.client_id) clientIds.add(c.client_id);
  }
  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (cid) => {
      const cs = await tenantCol(ctx.tenant.id, "clients").doc(cid).get().catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
  );

  const conversations = snap.docs
    .map((d) => {
      const c = d.data() as ConversationDoc;
      return {
        id: d.id,
        client_id: c.client_id,
        client_name: c.client_id ? clientMap.get(c.client_id) ?? null : null,
        client_phone: c.client_phone,
        last_message_at: toDate(c.last_message_at),
        last_message_preview: c.last_message_preview,
        last_direction: c.last_direction,
        unread_count: c.unread_count_for_owner,
        archived_at: toDate(c.archived_at),
      };
    })
    .filter((c) =>
      showArchived ? c.archived_at !== null : c.archived_at === null,
    );

  return NextResponse.json({ ok: true, conversations });
}
