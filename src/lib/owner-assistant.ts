/**
 * Role-aware tenant AI Assistant — Claude Sonnet 4.6 with tool-use against
 * the tenant's own data. Each tenant role gets a system prompt + scoped
 * tool set tuned to its job:
 *
 *   - tenant_owner       — full clinic data, all tools, financial visibility
 *   - tenant_manager     — operational + HR focus; no PHI charts but full
 *                          appointments/clients/metrics visibility
 *   - tenant_provider    — patient-care focus; clients + appointments,
 *                          NO financials, NO HR
 *   - tenant_front_desk  — scheduling + customer service; clients +
 *                          today's appointments + drafts, NO financials,
 *                          NO HR, NO charts
 *
 * Hard rules:
 *   - All tools are tenant-scoped — every Firestore read is namespaced via
 *     tenantCol(tenantId, ...) so a tenant can never see another's data.
 *   - Read-only by default. The one "action" tool returns a DRAFT — it
 *     does not auto-send. The user reviews + sends via the existing UI.
 *     This keeps HIPAA-grade compliance (no AI-initiated PHI transmission).
 *   - Available on every subscription tier. Usage is metered against the
 *     existing `ai_concierge_turns` counter so Basic gets 500/mo, Growth
 *     5000, Enterprise + Founding-25 unlimited.
 */

import Anthropic from "@anthropic-ai/sdk";
import { tenantCol } from "./tenant";
import { toDate } from "./firestore";
import type {
  ClientDoc,
  AppointmentDoc,
  ServiceDoc,
  ProviderDoc,
} from "./firestore-types";

const MODEL = "claude-sonnet-4-6";

export type AssistantRole =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk";

const SHARED_RULES = `Rules that apply to every role:
- ALWAYS scope answers to the tenant whose context is loaded — never invent
  client names or numbers.
- When the user asks for a draft, use the draft_client_message tool. It
  returns the proposed message text — the user reviews and sends from the
  inbox. Do NOT auto-send.
- Be concise. Bullets and short paragraphs over walls of text.
- For PHI (treatment specifics, photos, charts) — defer to the licensed
  provider. You can summarize what's in the record but flag that any
  clinical decision needs a licensed provider.
- If a tool returns no results, say so clearly. Don't invent.
- Ground your numbers. If you say "8 clients haven't been in 90+ days,"
  that count comes from a tool result, not a guess.`;

const ROLE_PROMPTS: Record<AssistantRole, string> = {
  tenant_owner: `You are the AI assistant for a medical-spa OWNER using Aesthera.
The owner sees everything — financials, team, clinical, marketing. Help
them run the business: client lookups, calendar, revenue/no-show metrics,
draft messages, identify reactivation candidates.\n\n${SHARED_RULES}`,

  tenant_manager: `You are the AI assistant for a medical-spa MANAGER (operations / GM
role). Help them with operational decisions: which providers had the most
no-shows, capacity utilization, complaint queue triage, low-stock alerts,
schedule coverage. You do NOT have access to provider charts — defer to a
provider if the user asks anything clinical. You DO have access to revenue
and operational metrics. Tone: practical, decisive, time-respecting.\n\n${SHARED_RULES}`,

  tenant_provider: `You are the AI assistant for a medical-spa licensed PROVIDER (injector,
NP, MD, aesthetician). Help them prep for visits: client history, prior
service notes, allergies on record, time since last treatment. Help them
draft post-visit messages to clients. You do NOT have access to financial
metrics, HR data, or another provider's charts unless the user is the
owner. Tone: clinical, precise, never recommend off-label use or specific
dosages — those are the provider's call.\n\n${SHARED_RULES}`,

  tenant_front_desk: `You are the AI assistant for a medical-spa FRONT DESK / receptionist.
Help them deliver excellent customer service: find a client, look up
today's schedule, draft a friendly reply to an inbound message, suggest a
rebook time when there's a cancellation. You do NOT have access to
financial metrics, HR data, complaints, or clinical charts. Tone: warm,
hospitality-grade, "concierge at a luxury hotel."\n\n${SHARED_RULES}`,
};

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  cached = new Anthropic({ apiKey: key });
  return cached;
}

// ── Tool definitions (sent to Claude) ──────────────────────────────────────

/** All tools we know how to execute. The actual tools advertised to the
 * model are filtered per role via ROLE_TOOL_NAMES below. */
const ALL_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_clients",
    description:
      "List clinic clients with optional filters. Returns up to 25 matches with id, name, email, last visit date, and tags. Use this when the owner asks 'who are my clients with X' or 'find Sarah Smith.'",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Substring match against full_name or email (case-insensitive). Optional.",
        },
        tag: {
          type: "string",
          description: "Filter to clients with this tag. Optional.",
        },
        days_since_last_visit_min: {
          type: "number",
          description: "Filter to clients whose most recent appointment was at least this many days ago. Use for reactivation queries (e.g. 90 days).",
        },
      },
    },
  },
  {
    name: "get_client",
    description: "Get full details for a specific client by their id. Returns name, email, phone, tags, marketing-consent flags, and the last 5 appointments.",
    input_schema: {
      type: "object",
      properties: {
        client_id: {
          type: "string",
          description: "The client document id (returned by list_clients).",
        },
      },
      required: ["client_id"],
    },
  },
  {
    name: "list_today_appointments",
    description: "List appointments for today, tomorrow, or a specific date. Returns time, client name, service, and provider.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD) in clinic local time. Defaults to today if omitted.",
        },
      },
    },
  },
  {
    name: "get_clinic_metrics",
    description: "Get clinic metrics: revenue, appointment count, no-show rate for a recent period.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "this_week", "this_month", "last_30_days"],
          description: "Period to summarize. Defaults to this_week.",
        },
      },
    },
  },
  {
    name: "draft_client_message",
    description:
      "Draft a personal message (email or SMS) for the owner to send to a client. Returns the proposed text — the owner reviews and sends from their inbox. Use when the user asks to write/draft/compose a message. Do NOT use for sending — there is no auto-send.",
    input_schema: {
      type: "object",
      properties: {
        client_id: {
          type: "string",
          description: "The client to address.",
        },
        channel: {
          type: "string",
          enum: ["email", "sms"],
          description: "Which medium the message will go via. SMS should be ≤ 160 chars; email can be longer.",
        },
        intent: {
          type: "string",
          description: "What the owner wants to communicate, in their own words. E.g. 'check in 21 days post-Botox' or 'reactivate, mention our new IV therapy service.'",
        },
      },
      required: ["client_id", "channel", "intent"],
    },
  },
];

/** Per-role tool whitelists. Front-desk + provider don't see clinic metrics
 * (financials are an owner/manager privilege). All roles can list/get
 * clients + appointments + draft messages — those are core to every job. */
const ROLE_TOOL_NAMES: Record<AssistantRole, string[]> = {
  tenant_owner: [
    "list_clients",
    "get_client",
    "list_today_appointments",
    "get_clinic_metrics",
    "draft_client_message",
  ],
  tenant_manager: [
    "list_clients",
    "get_client",
    "list_today_appointments",
    "get_clinic_metrics",
    "draft_client_message",
  ],
  tenant_provider: [
    "list_clients",
    "get_client",
    "list_today_appointments",
    "draft_client_message",
  ],
  tenant_front_desk: [
    "list_clients",
    "get_client",
    "list_today_appointments",
    "draft_client_message",
  ],
};

function toolsForRole(role: AssistantRole): Anthropic.Tool[] {
  const allowed = new Set(ROLE_TOOL_NAMES[role]);
  return ALL_TOOLS.filter((t) => allowed.has(t.name));
}

function isToolAllowedForRole(role: AssistantRole, toolName: string): boolean {
  return ROLE_TOOL_NAMES[role].includes(toolName);
}

// ── Tool execution (server-side, against tenant's own data) ────────────────

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export async function executeTool(args: {
  tenantId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}): Promise<ToolResult> {
  try {
    if (args.toolName === "list_clients") {
      return await execListClients(args.tenantId, args.toolInput);
    }
    if (args.toolName === "get_client") {
      return await execGetClient(args.tenantId, args.toolInput);
    }
    if (args.toolName === "list_today_appointments") {
      return await execListAppointments(args.tenantId, args.toolInput);
    }
    if (args.toolName === "get_clinic_metrics") {
      return await execGetMetrics(args.tenantId, args.toolInput);
    }
    if (args.toolName === "draft_client_message") {
      return await execDraftMessage(args.tenantId, args.toolInput);
    }
    return { ok: false, error: `Unknown tool: ${args.toolName}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function execListClients(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const search = typeof input.search === "string" ? input.search.toLowerCase().trim() : "";
  const tag = typeof input.tag === "string" ? input.tag.trim() : "";
  const daysMin = typeof input.days_since_last_visit_min === "number"
    ? input.days_since_last_visit_min
    : null;

  // Pull a slice; do JS-side filtering to keep this simple. For large
  // tenants this should move to indexed queries, but this assistant is
  // bounded by the monthly concierge-turn quota anyway.
  const snap = await tenantCol(tenantId, "clients")
    .orderBy("created_at", "desc")
    .limit(500)
    .get();

  const now = Date.now();
  const items = snap.docs
    .map((d) => {
      const c = d.data() as ClientDoc;
      const lastRaw = (c as { last_visit_at?: unknown }).last_visit_at;
      const last =
        lastRaw && typeof (lastRaw as { toDate?: () => Date }).toDate === "function"
          ? (lastRaw as { toDate: () => Date }).toDate()
          : null;
      const daysSince = last ? Math.floor((now - last.getTime()) / 86400000) : null;
      return {
        id: d.id,
        full_name: c.full_name ?? "(no name)",
        email: c.email ?? null,
        tags: Array.isArray(c.tags) ? c.tags : [],
        last_visit_date: last ? last.toISOString().slice(0, 10) : null,
        days_since_last_visit: daysSince,
      };
    })
    .filter((c) => {
      if (search) {
        const hit =
          c.full_name.toLowerCase().includes(search) ||
          (c.email ?? "").toLowerCase().includes(search);
        if (!hit) return false;
      }
      if (tag && !c.tags.includes(tag)) return false;
      if (daysMin !== null) {
        if (c.days_since_last_visit === null) return false;
        if (c.days_since_last_visit < daysMin) return false;
      }
      return true;
    })
    .slice(0, 25);

  return { ok: true, data: { count: items.length, clients: items } };
}

async function execGetClient(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const id = typeof input.client_id === "string" ? input.client_id : null;
  if (!id) return { ok: false, error: "client_id is required" };

  const cliSnap = await tenantCol(tenantId, "clients").doc(id).get();
  if (!cliSnap.exists) return { ok: false, error: "client not found" };
  const c = cliSnap.data() as ClientDoc;

  const apptSnap = await tenantCol(tenantId, "appointments")
    .where("client_id", "==", id)
    .orderBy("starts_at", "desc")
    .limit(5)
    .get()
    .catch(() => null);

  const recent = (apptSnap?.docs ?? []).map((d) => {
    const a = d.data() as AppointmentDoc;
    const start = toDate(a.starts_at);
    return {
      id: d.id,
      starts_at: start ? start.toISOString() : null,
      service: a.service ?? null,
      status: a.status,
    };
  });

  return {
    ok: true,
    data: {
      id: cliSnap.id,
      full_name: c.full_name ?? null,
      email: c.email ?? null,
      phone: (c as { phone?: string }).phone ?? null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      email_consent: !!(c as { email_consent?: boolean }).email_consent,
      sms_consent: !!(c as { sms_consent?: boolean }).sms_consent,
      recent_appointments: recent,
    },
  };
}

async function execListAppointments(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const dateStr = typeof input.date === "string" ? input.date : null;
  const start = dateStr ? new Date(`${dateStr}T00:00:00Z`) : startOfTodayUtc();
  const end = new Date(start.getTime() + 86400000);

  const snap = await tenantCol(tenantId, "appointments")
    .where("starts_at", ">=", start)
    .where("starts_at", "<", end)
    .orderBy("starts_at", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return { ok: true, data: { count: 0, appointments: [] } };

  // Resolve provider names + client names lazily so the AI can reference
  // people by name, not opaque doc IDs.
  const providerMap = await mapNames(tenantId, "providers");
  const clientIds = Array.from(
    new Set(
      snap.docs
        .map((d) => (d.data() as AppointmentDoc).client_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const clientMap = await mapClientNames(tenantId, clientIds);

  const items = snap.docs.map((d) => {
    const a = d.data() as AppointmentDoc;
    const s = toDate(a.starts_at);
    return {
      id: d.id,
      time: s ? s.toISOString().slice(11, 16) + "Z" : null,
      client_name: a.client_id ? clientMap.get(a.client_id) ?? null : null,
      service: a.service ?? null,
      provider_name: a.provider_id ? providerMap.get(a.provider_id) ?? null : null,
      status: a.status,
    };
  });

  return { ok: true, data: { date: start.toISOString().slice(0, 10), count: items.length, appointments: items } };
}

async function execGetMetrics(
  tenantId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const period = (input.period as string) ?? "this_week";
  const now = new Date();
  let start: Date;
  if (period === "today") start = startOfTodayUtc();
  else if (period === "this_month") start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  else if (period === "last_30_days") start = new Date(now.getTime() - 30 * 86400000);
  else start = startOfWeekUtc(); // this_week default

  const apptSnap = await tenantCol(tenantId, "appointments")
    .where("starts_at", ">=", start)
    .where("starts_at", "<=", now)
    .limit(2000)
    .get()
    .catch(() => null);

  const appts = apptSnap?.docs ?? [];
  let total = 0;
  let completed = 0;
  let noShow = 0;
  let cancelled = 0;
  let revenueCents = 0;
  for (const d of appts) {
    const a = d.data() as AppointmentDoc;
    total++;
    if (a.status === "completed") {
      completed++;
      revenueCents += Number((a as { price_cents?: number }).price_cents ?? 0);
    } else if (a.status === "no_show") {
      noShow++;
    } else if (a.status === "cancelled") {
      cancelled++;
    }
  }

  return {
    ok: true,
    data: {
      period,
      period_start: start.toISOString(),
      total_appointments: total,
      completed,
      no_show: noShow,
      cancelled,
      no_show_rate_pct: total > 0 ? Math.round((noShow / total) * 100) : 0,
      revenue_dollars: Math.round(revenueCents / 100),
    },
  };
}

async function execDraftMessage(
  _tenantId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  // The actual drafting work lives in the Claude turn that called this
  // tool — we just echo the parameters back so the model has confirmation
  // and the UI can surface the proposed channel + recipient. This keeps
  // the function pure (no side effects) and makes the "draft" visible in
  // the conversation transcript.
  const clientId = typeof input.client_id === "string" ? input.client_id : null;
  const channel = typeof input.channel === "string" ? input.channel : null;
  const intent = typeof input.intent === "string" ? input.intent : null;
  if (!clientId || !channel || !intent) {
    return { ok: false, error: "client_id, channel, and intent are all required" };
  }
  return {
    ok: true,
    data: {
      ready: true,
      client_id: clientId,
      channel,
      intent,
      next_step:
        "The assistant will compose the message text in its next turn. Show the draft to the owner; the owner sends from /owner/inbox.",
    },
  };
}

// ── Conversation runner ────────────────────────────────────────────────────

export type AssistantMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type AssistantTurn = {
  reply: string;
  tool_calls: { name: string; input: Record<string, unknown>; result: ToolResult }[];
};

export async function runAssistantTurn(args: {
  tenantId: string;
  role: AssistantRole;
  history: AssistantMessage[];
  userMessage: string;
  tenantName: string;
}): Promise<AssistantTurn> {
  const c = client();
  const collectedToolCalls: AssistantTurn["tool_calls"] = [];

  // Convert our flat history to Anthropic message shape. Existing turns
  // are plain text — they don't include tool blocks, so we pass them as
  // strings and let the new turn carry the tool dance.
  const messages: Anthropic.MessageParam[] = args.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({ role: "user", content: args.userMessage });

  // Run a tool-loop: ask Claude, if it calls tools execute them and feed
  // the results back, repeat until it returns a non-tool response. Cap at
  // 6 iterations as a safety limit.
  const tools = toolsForRole(args.role);
  const systemPrompt = `${ROLE_PROMPTS[args.role]}\n\nTenant context: clinic name is "${args.tenantName}".`;
  for (let i = 0; i < 6; i++) {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const textBlocks = res.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const reply = textBlocks.map((t) => t.text).join("\n").trim();
      return { reply, tool_calls: collectedToolCalls };
    }

    // Push the assistant message that included the tool_use blocks
    messages.push({ role: "assistant", content: res.content });

    // Execute each tool and push tool_result blocks. Defense-in-depth:
    // re-check the role whitelist on every tool call in case the model
    // hallucinated a tool we filtered out.
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      if (!isToolAllowedForRole(args.role, t.name)) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: JSON.stringify({
            error: `Tool "${t.name}" is not available for the ${args.role} role.`,
          }),
          is_error: true,
        });
        collectedToolCalls.push({
          name: t.name,
          input: t.input as Record<string, unknown>,
          result: { ok: false, error: "tool_not_allowed_for_role" },
        });
        continue;
      }
      const result = await executeTool({
        tenantId: args.tenantId,
        toolName: t.name,
        toolInput: t.input as Record<string, unknown>,
      });
      collectedToolCalls.push({
        name: t.name,
        input: t.input as Record<string, unknown>,
        result,
      });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }

  return {
    reply:
      "I tried a few different lookups but couldn't quite finish. Try rephrasing the question or breaking it into smaller asks.",
    tool_calls: collectedToolCalls,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfWeekUtc(): Date {
  const today = startOfTodayUtc();
  const day = today.getUTCDay(); // 0 = Sun
  return new Date(today.getTime() - day * 86400000);
}

async function mapNames(
  tenantId: string,
  collection: "services" | "providers",
): Promise<Map<string, string>> {
  const snap = await tenantCol(tenantId, collection).limit(200).get().catch(() => null);
  const map = new Map<string, string>();
  if (!snap) return map;
  for (const d of snap.docs) {
    const data = d.data() as ServiceDoc | ProviderDoc;
    const name = (data as { name?: string; full_name?: string }).name ??
      (data as { full_name?: string }).full_name ?? null;
    if (name) map.set(d.id, name);
  }
  return map;
}

async function mapClientNames(
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  // Firestore `in` queries cap at 30 ids — chunk through.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await tenantCol(tenantId, "clients")
      .where("__name__", "in", chunk)
      .get()
      .catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const data = d.data() as ClientDoc;
      if (data.full_name) map.set(d.id, data.full_name);
    }
  }
  return map;
}
