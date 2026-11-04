/**
 * Gift card helpers.
 *
 * Codes: 16-char base32 (Crockford-ish — no I/L/O/U) for human readability.
 * Doc ID = code, so we can look up by direct ref.
 */

import { randomBytes } from "node:crypto";

const ALPHA = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/1/I/L/O/U

export function generateGiftCardCode(): string {
  const buf = randomBytes(20);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += ALPHA[buf[i] % ALPHA.length];
  }
  return out.match(/.{1,4}/g)?.join("-") ?? out;
}
