/**
 * One-shot: provision the four Aesthera subscription products + prices
 * in Stripe AND emit the env-var set commands to wire them into Cloud Run.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
 *
 * Idempotent: looks up products by name and reuses if they exist.
 * Exits with the gcloud command to update Cloud Run.
 */

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY in env. Use a test key (sk_test_) first.");
  process.exit(1);
}
const stripe = new Stripe(key);

const TIERS = [
  {
    envVar: "STRIPE_PRICE_FOUNDING_25",
    name: "Aesthera — Founding 25",
    description: "Locked-in $99/mo for the first 25 clinics. All Growth-tier features + priority support.",
    unit_amount: 9900,
  },
  {
    envVar: "STRIPE_PRICE_BASIC",
    name: "Aesthera — Basic",
    description: "Solo or single-location. 1 location, up to 3 providers, booking + charting + marketing engine.",
    unit_amount: 19900,
  },
  {
    envVar: "STRIPE_PRICE_GROWTH",
    name: "Aesthera — Growth",
    description: "Multi-location. Up to 5 locations, unlimited providers, AI SOAP + AI marketing + AI concierge + SMS reminders.",
    unit_amount: 39900,
  },
  {
    envVar: "STRIPE_PRICE_ENTERPRISE",
    name: "Aesthera — Enterprise",
    description: "Groups + DSO-managed practices. Unlimited locations, SSO, SOC 2 paperwork, dedicated success.",
    unit_amount: 89900,
  },
];

const out = [];

for (const t of TIERS) {
  const products = await stripe.products.search({ query: `name:'${t.name.replace(/'/g, "\\'")}'`, limit: 1 });
  let product;
  if (products.data.length > 0) {
    product = products.data[0];
    console.log(`Reusing product: ${product.id} (${t.name})`);
  } else {
    product = await stripe.products.create({
      name: t.name,
      description: t.description,
      metadata: { aesthera_tier: t.envVar.replace("STRIPE_PRICE_", "").toLowerCase() },
    });
    console.log(`Created product: ${product.id} (${t.name})`);
  }

  // Find existing recurring USD monthly price at this amount, else create
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 50 });
  let price = prices.data.find(
    (p) =>
      p.recurring?.interval === "month" &&
      p.unit_amount === t.unit_amount &&
      p.currency === "usd",
  );
  if (price) {
    console.log(`  Reusing price: ${price.id} ($${(t.unit_amount / 100).toFixed(0)}/mo)`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: t.unit_amount,
      currency: "usd",
      recurring: { interval: "month" },
      nickname: `${t.name} monthly`,
    });
    console.log(`  Created price: ${price.id} ($${(t.unit_amount / 100).toFixed(0)}/mo)`);
  }
  out.push({ env: t.envVar, value: price.id });
}

console.log("\n--- Summary ---");
for (const { env, value } of out) {
  console.log(`${env}=${value}`);
}

const updateLine = out.map(({ env, value }) => `${env}=${value}`).join(",");
console.log("\n--- Cloud Run update command ---");
console.log(`gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \\
  --update-env-vars="STRIPE_SECRET_KEY=${key.slice(0, 7)}...REDACTED...,${updateLine}"`);

console.log("\nNext: create the webhook in https://dashboard.stripe.com/webhooks");
console.log("URL: https://medspa-web-1030670077341.us-central1.run.app/api/billing/webhook");
console.log("Events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed");
console.log("Then set STRIPE_WEBHOOK_SECRET in Cloud Run env.");
