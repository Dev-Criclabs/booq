// A fixed-window counter per key (F02-T24; design 5: a limit on POST /auth/session). The numbers
// come from platform config; none is invented here. It lives in the memory of one server process,
// so with several instances the real limit is per instance: a shared store (Redis, the database)
// replaces `hit` behind the same shape when the hosting is chosen.

export interface RateLimiter {
  hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
  size(): number;
}

export function createRateLimiter(options: { limit: number; windowSeconds: number; now(): Date; maxKeys?: number }): RateLimiter {
  const { limit, windowSeconds } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('rate limit: limit must be a whole number above zero');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error('rate limit: windowSeconds must be a whole number above zero');
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  function sweep(nowMs: number) {
    for (const [k, w] of windows) if (nowMs - w.start >= windowSeconds * 1000) windows.delete(k);
  }

  return {
    hit(key) {
      const nowMs = options.now().getTime();
      if (windows.size >= maxKeys) sweep(nowMs);
      let w = windows.get(key);
      if (!w || nowMs - w.start >= windowSeconds * 1000) {
        w = { start: nowMs, count: 0 };
        windows.set(key, w);
      }
      if (w.count < limit) {
        w.count += 1;
        return { allowed: true };
      }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowSeconds * 1000 - nowMs) / 1000)) };
    },
    size: () => windows.size,
  };
}
