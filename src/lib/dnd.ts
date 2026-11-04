/**
 * Do-Not-Disturb / suppression helpers.
 *
 * Whenever a contact bounces, complains, replies STOP/UNSUBSCRIBE, or is
 * otherwise determined unreachable, we do two things atomically:
 *
 *   1. Set contact.do_not_contact = true (and email_unsubscribed = true if
 *      the cause is unsubscribe-shaped).
 *   2. Cancel any queued scheduled_emails for that recipient.
 *
 * Both halves are essential — flagging without cancelling means the cron
 * will still fire pending emails for the next ~year. Cancelling without
 * flagging means new submits/enrolls will requeue them.
 */

import { db, now } from "./firestore";
import type { ContactDoc } from "./firestore-types";

export type DndReason =
  | "bounce_hard"
  | "bounce_soft"
  | "complained"
  | "unsubscribed"
  | "manual";

export async function flagContactDnd(
  email: string,
  reason: DndReason,
  detail?: string,
): Promise<{ flagged: boolean; cancelledScheduled: number }> {
  const lc = email.toLowerCase().trim();
  const ref = db().collection("contacts").doc(lc);
  const snap = await ref.get();
  if (!snap.exists) {
    // Still cancel any queued sends — contact may have been deleted but
    // scheduled rows could remain (rare but cheap to handle).
    const cancelled = await cancelScheduledEmails(lc, reason);
    return { flagged: false, cancelledScheduled: cancelled };
  }

  const cur = snap.data() as ContactDoc;
  const existingTags = Array.isArray(cur.tags) ? cur.tags : [];
  const dndTag = `dnd:${reason}`;
  const tags = existingTags.includes("dnd") ? existingTags : [...existingTags, "dnd"];
  const tagsWithReason = tags.includes(dndTag) ? tags : [...tags, dndTag];

  const update: Record<string, unknown> = {
    do_not_contact: true,
    tags: tagsWithReason,
    updated_at: now(),
  };
  if (reason === "unsubscribed" || reason === "complained") {
    update.email_unsubscribed = true;
  }
  if (detail) update.last_dnd_detail = detail;
  update.last_dnd_at = now();
  update.last_dnd_reason = reason;

  await ref.update(update);
  const cancelled = await cancelScheduledEmails(lc, reason);
  return { flagged: true, cancelledScheduled: cancelled };
}

/** Mark all queued scheduled_emails for an email as cancelled. */
export async function cancelScheduledEmails(
  email: string,
  reason: DndReason,
): Promise<number> {
  const snap = await db()
    .collection("scheduled_emails")
    .where("recipient_email", "==", email.toLowerCase().trim())
    .where("status", "==", "queued")
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return 0;

  const batch = db().batch();
  for (const d of snap.docs) {
    batch.update(d.ref, {
      status: "skipped",
      error: `cancelled_dnd:${reason}`,
    });
  }
  await batch.commit();
  return snap.size;
}

/** Heuristic: does this email body or subject look like an unsubscribe ask? */
export function looksLikeUnsubscribe(text: string): boolean {
  const t = text.toLowerCase();
  // Common unsubscribe keywords. Match whole-word where reasonable.
  const patterns = [
    /\bunsubscribe\b/,
    /\bunsub\b/,
    /\bopt[\s-]?out\b/,
    /\bremove me\b/,
    /\btake me off\b/,
    /\bstop emailing\b/,
    /\bdo not (?:email|contact)\b/,
    /\bno longer (?:interested|wish)\b/,
    /\b(?:please|pls)\s+stop\b/,
    /^\s*stop\s*$/im,
    /^\s*quit\s*$/im,
    /^\s*remove\s*$/im,
  ];
  return patterns.some((p) => p.test(t));
}

/** Heuristic: out-of-office auto-reply pattern. */
export function looksLikeOutOfOffice(args: { subject: string; body: string }): boolean {
  const s = (args.subject + " " + args.body).toLowerCase();
  const patterns = [
    /\bout of (?:the )?office\b/,
    /\bauto[\s-]?reply\b/,
    /\bauto[\s-]?responder\b/,
    /\bautomatic reply\b/,
    /\bout of office\b/,
    /\bon vacation\b/,
    /\bon (?:annual|paternity|maternity|medical) leave\b/,
    /\baway from (?:my )?desk\b/,
    /\bI (?:will be|am) (?:out|away)\b.*\b(?:return|back)\b/,
    /\boff (?:until|through)\b/,
  ];
  return patterns.some((p) => p.test(s));
}
