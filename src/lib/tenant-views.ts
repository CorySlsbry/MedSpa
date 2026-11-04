/**
 * Server-side helpers that fetch + shape tenant data for the role-specific
 * portal views. These are read-only "view" queries used by manager / front-
 * desk / provider pages — the actual mutations live on dedicated API
 * routes (e.g. /api/tenant/appointments/[id]/check-in).
 *
 * All queries are scoped via tenantCol(tenantId, ...) so cross-tenant
 * leakage is structurally impossible.
 */

import { Timestamp } from "firebase-admin/firestore";
import { tenantCol } from "./tenant";
import { toDate } from "./firestore";
import type {
  AppointmentDoc,
  ClientDoc,
  ProviderDoc,
} from "./firestore-types";
import type { AppointmentRow } from "@/components/TenantAppointmentsList";
import type { ClientRow } from "@/components/TenantClientsList";

/**
 * Fetch appointments in a date window, optionally filtered to a single
 * provider. Hydrates client + provider names so the table renders human
 * labels, not opaque IDs.
 */
export async function loadAppointments(args: {
  tenantId: string;
  /** ms-epoch start of window (inclusive). */
  fromMs: number;
  /** ms-epoch end of window (exclusive). */
  toMs: number;
  /** When set, only appointments for this provider doc id. */
  providerId?: string;
  /** Hard limit — defaults to 200. */
  limit?: number;
}): Promise<AppointmentRow[]> {
  const fromTs = Timestamp.fromMillis(args.fromMs);
  const toTs = Timestamp.fromMillis(args.toMs);

  let q = tenantCol(args.tenantId, "appointments")
    .where("starts_at", ">=", fromTs)
    .where("starts_at", "<", toTs)
    .orderBy("starts_at", "asc")
    .limit(args.limit ?? 200);
  if (args.providerId) {
    q = q.where("provider_id", "==", args.providerId);
  }
  const snap = await q.get().catch(() => null);
  if (!snap) return [];

  const docs = snap.docs;
  const clientIds = uniqueIds(docs.map((d) => (d.data() as AppointmentDoc).client_id));
  const providerIds = uniqueIds(docs.map((d) => (d.data() as AppointmentDoc).provider_id));
  const [clientNames, providerNames] = await Promise.all([
    fetchNames(args.tenantId, "clients", clientIds),
    fetchNames(args.tenantId, "providers", providerIds),
  ]);

  return docs.map((d) => {
    const a = d.data() as AppointmentDoc;
    const start = toDate(a.starts_at);
    const end = toDate(a.ends_at);
    return {
      id: d.id,
      starts_at_iso: start ? start.toISOString() : new Date().toISOString(),
      ends_at_iso: end ? end.toISOString() : new Date().toISOString(),
      client_id: a.client_id,
      client_name: clientNames.get(a.client_id) ?? "(unknown)",
      provider_id: a.provider_id,
      provider_name: providerNames.get(a.provider_id) ?? "(unknown)",
      service: a.service ?? "Visit",
      status: a.status ?? "scheduled",
      notes: a.notes ?? null,
    };
  });
}

/**
 * Fetch clients with optional filter to those who've been seen by a
 * specific provider (used by the Provider's My-clients page).
 */
export async function loadClients(args: {
  tenantId: string;
  /** When set, only clients with at least one appointment under this provider. */
  treatedByProviderId?: string;
  limit?: number;
}): Promise<ClientRow[]> {
  if (args.treatedByProviderId) {
    // Find the unique client_ids the provider has seen, then hydrate.
    const apptSnap = await tenantCol(args.tenantId, "appointments")
      .where("provider_id", "==", args.treatedByProviderId)
      .orderBy("starts_at", "desc")
      .limit(500)
      .get()
      .catch(() => null);
    if (!apptSnap) return [];

    const seen = new Map<string, Date>();
    for (const d of apptSnap.docs) {
      const a = d.data() as AppointmentDoc;
      const ts = toDate(a.starts_at);
      const prior = seen.get(a.client_id);
      if (!prior || (ts && ts > prior)) {
        if (ts) seen.set(a.client_id, ts);
        else if (!seen.has(a.client_id)) seen.set(a.client_id, new Date(0));
      }
    }
    const ids = Array.from(seen.keys());
    return hydrateClients(args.tenantId, ids, seen);
  }

  const snap = await tenantCol(args.tenantId, "clients")
    .orderBy("created_at", "desc")
    .limit(args.limit ?? 500)
    .get()
    .catch(() => null);
  if (!snap) return [];

  return snap.docs.map((d) => {
    const c = d.data() as ClientDoc;
    const lastRaw = (c as { last_visit_at?: unknown }).last_visit_at;
    const last =
      lastRaw && typeof (lastRaw as { toDate?: () => Date }).toDate === "function"
        ? (lastRaw as { toDate: () => Date }).toDate()
        : null;
    return {
      id: d.id,
      full_name: c.full_name ?? "(no name)",
      email: c.email ?? null,
      phone: (c as { phone?: string }).phone ?? null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      last_visit_iso: last ? last.toISOString() : null,
    };
  });
}

/** Find the ProviderDoc for a tenant_provider session user. */
export async function findProviderForUser(args: {
  tenantId: string;
  userEmail: string;
}): Promise<{ id: string; full_name: string } | null> {
  const snap = await tenantCol(args.tenantId, "providers")
    .where("email", "==", args.userEmail)
    .limit(1)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as ProviderDoc;
  return { id: d.id, full_name: data.full_name ?? "Provider" };
}

// ── helpers ────────────────────────────────────────────────────────────────

function uniqueIds(arr: (string | undefined | null)[]): string[] {
  return Array.from(new Set(arr.filter((x): x is string => typeof x === "string")));
}

async function fetchNames(
  tenantId: string,
  collection: "clients" | "providers",
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await tenantCol(tenantId, collection)
      .where("__name__", "in", chunk)
      .get()
      .catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const data = d.data() as ClientDoc | ProviderDoc;
      const name =
        (data as { full_name?: string }).full_name ??
        (data as { name?: string }).name ??
        null;
      if (name) map.set(d.id, name);
    }
  }
  return map;
}

async function hydrateClients(
  tenantId: string,
  ids: string[],
  lastVisitMap: Map<string, Date>,
): Promise<ClientRow[]> {
  if (ids.length === 0) return [];
  const out: ClientRow[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await tenantCol(tenantId, "clients")
      .where("__name__", "in", chunk)
      .get()
      .catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const c = d.data() as ClientDoc;
      const last = lastVisitMap.get(d.id) ?? null;
      out.push({
        id: d.id,
        full_name: c.full_name ?? "(no name)",
        email: c.email ?? null,
        phone: (c as { phone?: string }).phone ?? null,
        tags: Array.isArray(c.tags) ? c.tags : [],
        last_visit_iso: last && last.getTime() > 0 ? last.toISOString() : null,
      });
    }
  }
  // Sort by last visit desc, then alphabetical
  out.sort((a, b) => {
    const aT = a.last_visit_iso ? Date.parse(a.last_visit_iso) : 0;
    const bT = b.last_visit_iso ? Date.parse(b.last_visit_iso) : 0;
    if (aT !== bT) return bT - aT;
    return a.full_name.localeCompare(b.full_name);
  });
  return out;
}
