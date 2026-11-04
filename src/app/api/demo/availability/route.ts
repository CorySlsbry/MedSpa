/**
 * GET /api/demo/availability?date=YYYY-MM-DD
 *
 * Returns the list of HH:MM slot start times that are already booked on
 * the given date. The client computes "unavailable" by treating each
 * booking as a 30-min reservation that blocks itself plus the adjacent
 * 15-min slots.
 *
 * Date is interpreted in America/Denver (Mountain). The booking itself
 * is stored with explicit local time + tz so DST handling is consistent.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  try {
    const snap = await db()
      .collection("demo_bookings")
      .where("date", "==", date)
      .where("status", "==", "booked")
      .get();
    const booked = snap.docs.map((d) => (d.data() as { time: string }).time);
    return NextResponse.json({ date, booked });
  } catch (err) {
    console.error("[demo-availability]", err);
    return NextResponse.json({ date, booked: [] });
  }
}
