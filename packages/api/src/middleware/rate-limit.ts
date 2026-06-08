import type { Context, Next } from 'hono';

/**
 * Simple in-memory rate limiter scoped to channel_name.
 * For production, replace with a DurableObject-backed limiter.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function getEntry(key: string, windowMs: number): RateLimitEntry {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  return entry;
}

// Periodic cleanup — run ~1% of the time
function maybeCleanup(): void {
  if (Math.random() > 0.01) return;
  const now = Date.now();
  for (const [key, val] of store) {
    if (now > val.resetAt) store.delete(key);
  }
}

export function channelRateLimit(opts: { windowMs?: number; maxRequests?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 60;

  return async (c: Context, next: Next) => {
    const channelName = c.req.param('channel_name');
    if (!channelName) return next();

    maybeCleanup();

    const entry = getEntry(`ingest:${channelName}`, windowMs);
    entry.count++;

    if (entry.count > maxRequests) {
      return c.json(
        { ok: false, error: { code: 'rate_limited', message: 'Channel rate limit exceeded' } },
        429,
      );
    }

    return next();
  };
}
