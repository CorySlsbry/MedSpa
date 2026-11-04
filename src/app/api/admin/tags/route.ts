/**
 * GET /api/admin/tags — list all distinct tags currently in use across
 * contacts + workflows. Used by the WorkflowFlowEditor so apply_tag /
 * remove_tag steps can suggest existing tags as the user types.
 *
 * No separate tags collection — tags are just strings on contacts/leads,
 * so "creating" a tag is implicit (typing a new string in a workflow step
 * causes it to be applied at run time). This endpoint is suggestions-only.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { db } from "@/lib/firestore";
import type { ContactDoc, WorkflowDoc, WorkflowStep } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const set = new Set<string>();

  const contactsSnap = await db().collection("contacts").select("tags").limit(2000).get();
  for (const d of contactsSnap.docs) {
    const data = d.data() as Pick<ContactDoc, "tags">;
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) if (typeof t === "string" && t.trim()) set.add(t.trim());
    }
  }

  const workflowsSnap = await db().collection("workflows").select("steps", "trigger_config").limit(200).get();
  for (const d of workflowsSnap.docs) {
    const data = d.data() as Pick<WorkflowDoc, "steps" | "trigger_config">;
    const triggerTag = (data.trigger_config as { tag?: unknown } | undefined)?.tag;
    if (typeof triggerTag === "string" && triggerTag.trim()) set.add(triggerTag.trim());
    if (Array.isArray(data.steps)) {
      for (const s of data.steps as WorkflowStep[]) {
        if (s.action === "apply_tag" || s.action === "remove_tag") {
          const t = (s.config as { tag?: unknown }).tag;
          if (typeof t === "string" && t.trim()) set.add(t.trim());
        }
      }
    }
  }

  const tags = Array.from(set).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ ok: true, tags });
}
