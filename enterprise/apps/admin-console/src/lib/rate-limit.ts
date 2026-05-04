/** Process-local fixed window rate limiter (upgrade to Redis when multi-instance). */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function takeToken(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (b.count >= max) {
    return false;
  }
  b.count += 1;
  return true;
}
