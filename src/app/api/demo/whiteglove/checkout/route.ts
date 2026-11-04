/**
 * GET/POST /api/demo/whiteglove/checkout
 *
 * Public route that creates a Stripe Checkout Session for the $1,500
 * white-glove onboarding fee. Anyone can buy — they don't need to be a
 * tenant yet. After payment, the session lands them on a thank-you
 * page and Cory is notified to schedule the kickoff call.
 *
 * Pre-req: STRIPE_PRICE_WHITEGLOVE env var is the Stripe Price ID for
 * the one-time $1,500 product. If unset, the route returns a friendly
 * message + a calendar link so the prospect can still book a call.
 */

import { NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  const priceId = process.env.STRIPE_PRICE_WHITEGLOVE;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

  if (!isStripeConfigured() || !priceId) {
    // Pricing not yet wired — bounce them back to the marketing page with a
    // banner explaining the next step.
    const url = new URL("/?whiteglove=pending", baseUrl);
    return NextResponse.redirect(url, { status: 302 });
  }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?whiteglove=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?whiteglove=cancel#white-glove`,
      allow_promotion_codes: true,
      payment_intent_data: {
        description: "Aesthera white-glove onboarding · one-time setup fee",
      },
      metadata: {
        product: "whiteglove_onboarding",
      },
      // Capture customer info so Cory has it without a separate form
      customer_creation: "always",
    });
    if (!session.url) {
      throw new Error("No checkout URL returned by Stripe.");
    }
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("[whiteglove-checkout]", err);
    const url = new URL("/?whiteglove=error", baseUrl);
    return NextResponse.redirect(url, { status: 302 });
  }
}
