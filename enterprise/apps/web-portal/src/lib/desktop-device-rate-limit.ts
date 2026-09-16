/** Process-local fixed window rate limiter for Desktop device auth endpoints. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function takeToken(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= max) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper. */
export function __resetDesktopDeviceRateLimitForTests(): void {
  buckets.clear();
}
