/**
 * Monitor the Aesthera CRM during a live Apollo ingest test.
 *
 * Watches for new contacts/companies/leads/workflow_enrollments and
 * flags anything that doesn't look like a med spa.
 *
 * Usage:
 *   node scripts/monitor-apollo-ingest.mjs                 # baseline + watch
 *   node scripts/monitor-apollo-ingest.mjs --baseline      # baseline only
 *   node scripts/monitor-apollo-ingest.mjs --since=<iso>   # report rows since timestamp
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

const MED_SPA_TYPES = new Set([
  "med_spa",
  "aesthetic_clinic",
  "iv_lounge",
  "wellness_studio",
  "lash_brow_studio",
  "head_spa",
]);

// Strong negative signal — words that should never appear in a med-spa company name
const NON_MEDSPA_TOKENS = [
  "construction",
  "builder",
  "roofing",
  "plumbing",
  "electric ",
  "hvac",
  "concrete",
  "remodel",
  "framing",
  "landscaping",
  "real estate",
  "realty",
  "realtor",
  "homes",
  "brokerage",
  "property mgmt",
  "property management",
  "title",
  "escrow",
  "mortgage",
  "lending",
  "appraisal",
  "cpa",
  "bookkeeping",
  "accounting",
  "accountant",
];

// Soft positive signal
const MEDSPA_TOKENS = [
  "spa",
  "aesthet",
  "skin",
  "laser",
  "botox",
  "wellness",
  "iv ",
  "iv-",
  "drip",
  "med ",
  "medi-",
  "beauty",
  "rejuven",
  "lash",
  "brow",
  "facial",
  "derm",
  "cosmetic",
  "anti-aging",
  "glow",
  "luxe",
  "clinic",
];

function classifyCompany(c) {
  const name = (c.name || "").toLowerCase();
  const negatives = NON_MEDSPA_TOKENS.filter((t) => name.includes(t));
  const positives = MEDSPA_TOKENS.filter((t) => name.includes(t));
  const typeOk = MED_SPA_TYPES.has(c.type);
  let verdict = "OK";
  const reasons = [];
  if (negatives.length > 0) {
    verdict = "FLAG";
    reasons.push(`name contains: ${negatives.join(", ")}`);
  }
  if (!typeOk && c.type && c.type !== "unknown") {
    verdict = "FLAG";
    reasons.push(`type=${c.type} not in med-spa whitelist`);
  } else if (c.type === "unknown" || !c.type) {
    if (verdict === "OK" && positives.length === 0) verdict = "REVIEW";
    reasons.push(`type=${c.type || "(missing)"}, no med-spa keywords in name`);
  }
  return { verdict, reasons, positives, type: c.type, name: c.name };
}

async function snapshot() {
  const since = new Date(Date.now() - 24 * 3600 * 1000); // last 24h window for "recent"
  const sinceTs = Timestamp.fromDate(since);

  const [leadsSnap, contactsSnap, companiesSnap, enrollSnap] = await Promise.all([
    db.collection("leads").orderBy("created_at", "desc").limit(50).get(),
    db.collection("contacts").orderBy("updated_at", "desc").limit(50).get(),
    db.collection("companies").orderBy("created_at", "desc").limit(50).get(),
    db.collection("workflow_enrollments").orderBy("enrolled_at", "desc").limit(50).get(),
  ]);

  return {
    leads: leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    contacts: contactsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    companies: companiesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    enrollments: enrollSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    sinceTs,
  };
}

async function listWorkflows() {
  const snap = await db.collection("workflows").orderBy("name").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listRecentAuditForJarvis(sinceTs) {
  try {
    const snap = await db
      .collection("audit_log")
      .where("target_type", "==", "lead.jarvis_apollo")
      .where("created_at", ">=", sinceTs)
      .orderBy("created_at", "desc")
      .limit(50)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

function fmtTime(ts) {
  if (!ts) return "—";
  if (ts.toDate) return ts.toDate().toISOString().slice(11, 19);
  if (ts._seconds) return new Date(ts._seconds * 1000).toISOString().slice(11, 19);
  return String(ts);
}

function reportSnapshot(label, snap) {
  console.log("\n=== " + label + " @ " + new Date().toISOString() + " ===");
  console.log(`leads: ${snap.leads.length} (most recent ${snap.leads[0]?.created_at ? fmtTime(snap.leads[0].created_at) : "—"})`);
  console.log(`contacts: ${snap.contacts.length}`);
  console.log(`companies: ${snap.companies.length}`);
  console.log(`workflow_enrollments: ${snap.enrollments.length}`);

  const flagged = [];
  for (const c of snap.companies) {
    const cls = classifyCompany(c);
    if (cls.verdict !== "OK") {
      flagged.push({ id: c.id, name: c.name, type: c.type, source: c.source, reasons: cls.reasons, verdict: cls.verdict });
    }
  }
  if (flagged.length === 0) {
    console.log("✓ All companies look like med spas");
  } else {
    console.log(`⚠ ${flagged.length} companies need review:`);
    for (const f of flagged) {
      console.log(`  [${f.verdict}] ${f.name} (type=${f.type}, src=${f.source}) — ${f.reasons.join("; ")}`);
    }
  }

  // Recent jarvis_apollo leads breakdown
  const jarvisLeads = snap.leads.filter((l) => l.utm_medium === "apollo" || l.company?.type !== undefined);
  if (jarvisLeads.length > 0) {
    console.log(`\nMost-recent ${Math.min(jarvisLeads.length, 8)} leads:`);
    for (const l of jarvisLeads.slice(0, 8)) {
      const cls = classifyCompany(l.company || {});
      const flag = cls.verdict === "OK" ? "✓" : cls.verdict === "REVIEW" ? "?" : "⚠";
      console.log(
        `  ${flag} ${fmtTime(l.created_at)} ${l.contact?.email || "(no email)"} @ ${
          l.company?.name || "(no company)"
        } [${l.company?.type || "?"}] src=${l.source}`,
      );
    }
  }

  return { flagged, jarvisLeads };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const baselineOnly = args.has("--baseline");

  console.log("Connecting to Firestore (project: medspa-494718)...");
  const wfs = await listWorkflows();
  console.log(`\nWorkflows in CRM (${wfs.length}):`);
  for (const w of wfs) {
    console.log(
      `  - [${w.status}] ${w.name} (id=${w.id}, trigger=${w.trigger_type}, tag=${w.trigger_config?.tag || "—"}, active_enrollments=${w.active_enrollments ?? 0})`,
    );
  }

  const baseline = await snapshot();
  reportSnapshot("BASELINE", baseline);

  if (baselineOnly) {
    process.exit(0);
  }

  console.log("\n→ Watching for changes every 15s. Ctrl-C to stop.\n");
  const knownLeadIds = new Set(baseline.leads.map((l) => l.id));
  const knownContactIds = new Set(baseline.contacts.map((c) => c.id));
  const knownCompanyIds = new Set(baseline.companies.map((c) => c.id));
  const knownEnrollIds = new Set(baseline.enrollments.map((e) => e.id));

  while (true) {
    await new Promise((r) => setTimeout(r, 15000));
    const cur = await snapshot();

    const newLeads = cur.leads.filter((l) => !knownLeadIds.has(l.id));
    const newContacts = cur.contacts.filter((c) => !knownContactIds.has(c.id));
    const newCompanies = cur.companies.filter((c) => !knownCompanyIds.has(c.id));
    const newEnrolls = cur.enrollments.filter((e) => !knownEnrollIds.has(e.id));

    if (newLeads.length || newCompanies.length || newEnrolls.length) {
      console.log(`\n+++ Change @ ${new Date().toISOString()} +++`);
      console.log(
        `  +leads: ${newLeads.length}, +contacts: ${newContacts.length}, +companies: ${newCompanies.length}, +enrollments: ${newEnrolls.length}`,
      );
      for (const c of newCompanies) {
        const cls = classifyCompany(c);
        const flag = cls.verdict === "OK" ? "✓" : cls.verdict === "REVIEW" ? "?" : "⚠";
        console.log(
          `  ${flag} new company: ${c.name} [type=${c.type}, src=${c.source}] — ${cls.reasons.join("; ") || "looks fine"}`,
        );
      }
      for (const l of newLeads) {
        const cls = classifyCompany(l.company || {});
        const flag = cls.verdict === "OK" ? "✓" : cls.verdict === "REVIEW" ? "?" : "⚠";
        console.log(
          `  ${flag} new lead: ${l.contact?.email || "(no email)"} @ ${l.company?.name || "(no company)"} [type=${
            l.company?.type || "?"
          }, src=${l.source}, utm=${l.utm_source}/${l.utm_medium}]`,
        );
      }
      for (const e of newEnrolls) {
        console.log(`  → enrollment: ${e.contact_email} into "${e.workflow_name}" (status=${e.status})`);
      }
      newLeads.forEach((l) => knownLeadIds.add(l.id));
      newContacts.forEach((c) => knownContactIds.add(c.id));
      newCompanies.forEach((c) => knownCompanyIds.add(c.id));
      newEnrolls.forEach((e) => knownEnrollIds.add(e.id));
    } else {
      process.stdout.write(".");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
