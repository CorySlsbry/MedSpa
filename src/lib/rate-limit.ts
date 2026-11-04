/**
 * In-memory rate limiter — token bucket per key.
 *
 * IMPORTANT LIMITATION: Cloud Run scales horizontally. This limiter is
 * per-instance, not global. For a low-volume marketing-site form that's
 * acceptable as basic abuse mitigation. For higher-stakes endpoints
 * (login, password reset), use Cloud Memorystore (Redis) or a Firestore-
 * backed counter — that's a Phase 2 upgrade.
 *
 * Default config: 10 requests / IP / hour for /api/demo. Generous for a
 * legitimate marketer testing the form, tight enough to make scripted
 * abuse expensive.
 */

type Bucket = {
  tokens: number;
  lastRefill: number;
};

const buckets = new Map<string, Bucket>();

// Periodically prune buckets to keep memory bounded
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const PRUNE_AGE_MS = 60 * 60 * 1000;

let lastPrune = Date.now();
function prune(now: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, b] of buckets.entries()) {
    if (now - b.lastRefill > PRUNE_AGE_MS) buckets.delete(key);
  }
}

export type RateLimitConfig = {
  /** How many requests to allow within the window. */
  capacity: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  prune(now);

  const refillRate = config.capacity / config.windowMs; // tokens per ms
  const existing = buckets.get(key);

  if (!existing) {
    buckets.set(key, { tokens: config.capacity - 1, lastRefill: now });
    return {
      allowed: true,
      remaining: config.capacity - 1,
      resetMs: config.windowMs,
    };
  }

  const elapsed = now - existing.lastRefill;
  const refilled = Math.min(
    config.capacity,
    existing.tokens + elapsed * refillRate,
  );

  if (refilled < 1) {
    const resetMs = Math.ceil((1 - refilled) / refillRate);
    return { allowed: false, remaining: 0, resetMs };
  }

  existing.tokens = refilled - 1;
  existing.lastRefill = now;
  return {
    allowed: true,
    remaining: Math.floor(existing.tokens),
    resetMs: Math.ceil((config.capacity - existing.tokens) / refillRate),
  };
}

export const DEMO_FORM_LIMIT: RateLimitConfig = {
  capacity: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
};
