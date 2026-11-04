/**
 * Vertex AI Gemini wrapper — server-side only.
 *
 * Uses Application Default Credentials (Cloud Run runtime SA, with
 * roles/aiplatform.user) to mint access tokens; calls the Vertex AI
 * generateContent REST endpoint with structured output (responseSchema).
 *
 * No client-side use — never bundle this. The calls happen from /api/*
 * server routes only.
 */

import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.VERTEX_AI_PROJECT || "medspa-494718";
const LOCATION = process.env.VERTEX_AI_LOCATION || "us-central1";
// Current stable Gemini Flash on Vertex AI as of 2026-04. The 1.5 line is
// deprecated and returns 404. Override via VERTEX_AI_MODEL env if needed.
const MODEL = process.env.VERTEX_AI_MODEL || "gemini-2.5-flash";

let authClient: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (authClient) return authClient;
  authClient = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });
  return authClient;
}

export type SoapDraft = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

const SOAP_SCHEMA = {
  type: "object",
  properties: {
    subjective: { type: "string" },
    objective: { type: "string" },
    assessment: { type: "string" },
    plan: { type: "string" },
  },
  required: ["subjective", "objective", "assessment", "plan"],
} as const;

const SYSTEM_INSTRUCTION = `You are a clinical charting assistant for a medical aesthetics practice.
Draft a starter SOAP note (Subjective, Objective, Assessment, Plan) for the
provider to review and edit. Never invent specific clinical findings, dosages,
or vitals — those must come from the provider. Use placeholder phrases like
"per provider observation" where specifics are needed. Keep each section
concise (2-4 sentences). Use professional clinical tone.

Hard rules:
- DO NOT invent vital signs, exam findings, or specific measurements.
- DO NOT recommend off-label uses or dosages.
- DO acknowledge prior visit content if provided.
- DO use the service name and any service-specific care patterns
  (e.g. for Botox: pre-treatment skin assessment, target areas, post-care).
- The provider edits + signs. This is a draft, not a final.`;

type ContextInput = {
  serviceName: string;
  serviceCategory: string;
  serviceDurationMinutes: number;
  clientName: string;
  clientTags: string[];
  appointmentNotes: string | null;
  // Optional prior visit content
  priorChart?: {
    subjective: string | null;
    objective: string | null;
    assessment: string | null;
    plan: string | null;
    signedAt: Date | null;
  } | null;
};

function buildPrompt(ctx: ContextInput): string {
  const lines: string[] = [];
  lines.push(`Service: ${ctx.serviceName} (${ctx.serviceCategory.replace(/_/g, " ")}, ${ctx.serviceDurationMinutes} min)`);
  lines.push(`Client: ${ctx.clientName}`);
  if (ctx.clientTags.length > 0) {
    lines.push(`Client tags: ${ctx.clientTags.join(", ")}`);
  }
  if (ctx.appointmentNotes) {
    lines.push(`Booking notes from client: ${ctx.appointmentNotes}`);
  }
  if (ctx.priorChart) {
    lines.push(`\n--- Prior visit chart ${ctx.priorChart.signedAt?.toLocaleDateString() ?? ""} ---`);
    if (ctx.priorChart.subjective) lines.push(`Subjective (prior): ${ctx.priorChart.subjective}`);
    if (ctx.priorChart.objective) lines.push(`Objective (prior): ${ctx.priorChart.objective}`);
    if (ctx.priorChart.assessment) lines.push(`Assessment (prior): ${ctx.priorChart.assessment}`);
    if (ctx.priorChart.plan) lines.push(`Plan (prior): ${ctx.priorChart.plan}`);
  } else {
    lines.push(`\n(No prior visit on file — treat as a new-patient draft.)`);
  }
  lines.push(`\nDraft a SOAP starter for THIS visit. Output JSON matching the schema.`);
  return lines.join("\n");
}

// ── Marketing message generation ────────────────────────────────────────────

export type MarketingDraft = {
  subject: string;
  body_html: string;
  body_text: string;
};

const MARKETING_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body_html: { type: "string" },
    body_text: { type: "string" },
  },
  required: ["subject", "body_html", "body_text"],
} as const;

const MARKETING_SYSTEM = `You are a marketing copy assistant for a medical aesthetics clinic.
Write warm, on-brand emails that respect the client and prompt one specific
next action. Never invent prices, claims, or guarantees. Never use
manipulative urgency ("only 2 spots left!"). Match the clinic's voice
described in the brief.

Hard rules:
- Subject line under 60 characters. Personal but not gimmicky.
- Body 80-180 words. Plain text style, conversational, not corporate.
- Use the client's preferred name if provided, otherwise first name.
- Always end with one clear call-to-action linking to the booking page.
- Never mention prices unless the brief explicitly includes them.
- Never invent service results, recovery times, or clinical claims.
- HTML body: simple inline-styled paragraphs, no images. Plain text body
  is the same content with no HTML tags.`;

const TRIGGER_INSTRUCTION: Record<string, string> = {
  birthday_week:
    "It's the client's birthday week. Send a warm note. Optionally offer a small gesture if the brief mentions one. Don't fabricate offers.",
  post_treatment_21_day:
    "It's been ~3 weeks since their last treatment. Check in on results, invite them to share how they're feeling, and tee up the natural follow-up timing.",
  reactivation_90_day:
    "It's been 90+ days since they were in. Don't be guilty-trippy. Acknowledge time has passed, share something genuine, invite them back.",
  welcome_new_client:
    "They just had their first visit. Welcome them, set expectations for follow-up, and make them feel taken care of.",
  upsell_post_visit:
    "Suggest a complementary service that naturally pairs with what they just had. Educational tone, not pushy. Owner's brief specifies the suggested service.",
};

type MarketingContext = {
  trigger: string;
  // Tenant
  tenantName: string;
  tenantBrief: string; // what the campaign is about + tone, owner-controlled
  callToAction: string | null;
  bookingUrl: string;
  // Client
  clientFirstName: string;
  clientPreferredName: string | null;
  clientTags: string[];
  // History
  lastServiceName: string | null;
  daysSinceLastVisit: number | null;
};

function buildMarketingPrompt(ctx: MarketingContext): string {
  const display = ctx.clientPreferredName || ctx.clientFirstName || "there";
  const lines: string[] = [];
  lines.push(`Trigger: ${ctx.trigger}`);
  lines.push(`Trigger context: ${TRIGGER_INSTRUCTION[ctx.trigger] ?? "Marketing follow-up."}`);
  lines.push(`Clinic: ${ctx.tenantName}`);
  lines.push(`Owner brief (tone + intent): ${ctx.tenantBrief}`);
  if (ctx.callToAction) lines.push(`Call to action text: "${ctx.callToAction}"`);
  lines.push(`Booking link to use: ${ctx.bookingUrl}`);
  lines.push(`Client first name: ${ctx.clientFirstName}`);
  lines.push(`Client preferred name: ${display}`);
  if (ctx.clientTags.length > 0) lines.push(`Client tags: ${ctx.clientTags.join(", ")}`);
  if (ctx.lastServiceName) lines.push(`Last service: ${ctx.lastServiceName}`);
  if (ctx.daysSinceLastVisit !== null)
    lines.push(`Days since last visit: ${ctx.daysSinceLastVisit}`);
  lines.push(``);
  lines.push(`Write the email per the system rules. Output JSON matching the schema.`);
  return lines.join("\n");
}

/**
 * Generate a personalized marketing email via Vertex AI Gemini. Throws
 * on failure.
 */
export async function generateMarketingMessage(
  ctx: MarketingContext,
): Promise<MarketingDraft> {
  const client = await getAuth().getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error("Could not mint Vertex AI access token.");

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: MARKETING_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: buildMarketingPrompt(ctx) }] }],
    generationConfig: {
      temperature: 0.7, // marketing copy needs more creativity
      topP: 0.95,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      responseSchema: MARKETING_SCHEMA,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex AI returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Vertex AI returned no content.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Vertex AI returned non-JSON: ${(err as Error).message}`);
  }
  const draft = parsed as Partial<MarketingDraft>;
  return {
    subject: String(draft.subject ?? "").slice(0, 200),
    body_html: String(draft.body_html ?? ""),
    body_text: String(draft.body_text ?? ""),
  };
}

// ── Booking concierge ───────────────────────────────────────────────────────

export type ConciergeMessage = { role: "user" | "assistant"; content: string };

export type ConciergeReply = {
  assistant_message: string;
  recommended_service_id: string | null;
  ask_followup: string | null;
};

const CONCIERGE_SCHEMA = {
  type: "object",
  properties: {
    assistant_message: { type: "string" },
    recommended_service_id: { type: "string", nullable: true },
    ask_followup: { type: "string", nullable: true },
  },
  required: ["assistant_message"],
} as const;

const CONCIERGE_SYSTEM = `You are a friendly booking concierge for a medical aesthetics clinic.
You help prospective clients pick the right service from the clinic's
catalog and guide them to book.

Hard rules:
- ONLY recommend services that exist in the catalog provided. Use their
  exact id from the catalog when filling recommended_service_id.
- NEVER invent prices, results, recovery time, or clinical claims. If a
  client asks "will this work for me?" or "how long will results last?",
  steer them to a consultation or to the provider — do NOT promise outcomes.
- NEVER provide medical advice, diagnose conditions, or recommend off-label
  uses. If asked, say "the provider will assess at the visit."
- Be warm, brief (1-3 sentences), and conversational. Avoid corporate copy.
- If the client's intent is clear, set recommended_service_id to one
  service and write the message as a short recommendation with a hand-off
  to "let's get you booked."
- If you need more info (skin concern, downtime tolerance, body area,
  etc), set ask_followup to a single follow-up question and leave
  recommended_service_id null.
- If the catalog has nothing close, say so honestly — don't force a fit.`;

type ConciergeContext = {
  tenantName: string;
  catalog: Array<{
    id: string;
    name: string;
    category: string;
    duration_minutes: number;
    description: string | null;
    price_cents: number | null;
  }>;
  messages: ConciergeMessage[];
};

function buildConciergeUserContent(ctx: ConciergeContext): string {
  const lines: string[] = [];
  lines.push(`Clinic: ${ctx.tenantName}`);
  lines.push(`\nService catalog (id · name · category · duration · price):`);
  for (const s of ctx.catalog) {
    const price = s.price_cents != null ? `$${(s.price_cents / 100).toFixed(0)}` : "price on request";
    lines.push(
      `- ${s.id} · ${s.name} · ${s.category.replace(/_/g, " ")} · ${s.duration_minutes}min · ${price}${s.description ? ` — ${s.description}` : ""}`,
    );
  }
  lines.push(`\n--- Conversation so far ---`);
  for (const m of ctx.messages) {
    lines.push(`${m.role === "user" ? "Client" : "Concierge"}: ${m.content}`);
  }
  lines.push(``);
  lines.push(`Reply to the most recent client message. Output JSON matching the schema.`);
  return lines.join("\n");
}

/**
 * Generate a concierge reply via Vertex AI Gemini. Throws on failure.
 */
export async function generateConciergeReply(ctx: ConciergeContext): Promise<ConciergeReply> {
  const client = await getAuth().getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error("Could not mint Vertex AI access token.");

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: CONCIERGE_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: buildConciergeUserContent(ctx) }] }],
    generationConfig: {
      temperature: 0.5,
      topP: 0.95,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
      responseSchema: CONCIERGE_SCHEMA,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex AI returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Vertex AI returned no content.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Vertex AI returned non-JSON: ${(err as Error).message}`);
  }
  const reply = parsed as Partial<ConciergeReply>;
  const recommendedId = typeof reply.recommended_service_id === "string" ? reply.recommended_service_id : null;
  // Safety: only honor recommended_service_id if it exists in catalog
  const validId = recommendedId && ctx.catalog.some((s) => s.id === recommendedId) ? recommendedId : null;
  return {
    assistant_message: String(reply.assistant_message ?? "").slice(0, 1000),
    recommended_service_id: validId,
    ask_followup: typeof reply.ask_followup === "string" ? reply.ask_followup.slice(0, 300) : null,
  };
}

/**
 * Generate a SOAP draft via Vertex AI Gemini. Throws on failure.
 */
export async function generateSoapDraft(ctx: ContextInput): Promise<SoapDraft> {
  const client = await getAuth().getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error("Could not mint Vertex AI access token.");

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt(ctx) }] }],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      responseSchema: SOAP_SCHEMA,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex AI returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Vertex AI returned no content.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Vertex AI returned non-JSON: ${(err as Error).message}`);
  }
  const draft = parsed as Partial<SoapDraft>;
  return {
    subjective: String(draft.subjective ?? ""),
    objective: String(draft.objective ?? ""),
    assessment: String(draft.assessment ?? ""),
    plan: String(draft.plan ?? ""),
  };
}
