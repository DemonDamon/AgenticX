type DiversifyOptions = {
  limit?: number;
  maxPerHost?: number;
};

/** Normalize a source URL to a host without knowing anything about its provider. */
export function sourceHostname(raw: string): string {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/**
 * Keep the upstream relevance order, but give every host one slot before a
 * second page from any host. Remaining pages then keep their original order.
 */
export function diversifyBySourceHost<T>(
  items: T[],
  urlOf: (item: T) => string,
  options: DiversifyOptions = {},
): T[] {
  if (items.length <= 1) return items.slice();

  const limit = Math.max(0, Math.min(items.length, options.limit ?? items.length));
  const maxPerHost = Math.max(1, options.maxPerHost ?? Number.POSITIVE_INFINITY);
  const firstByHost: T[] = [];
  const remainder: T[] = [];
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const host = sourceHostname(urlOf(item));
    // Invalid URLs should not collapse into one synthetic host.
    const key = host || `invalid:${index}`;
    if (seen.has(key)) {
      remainder.push(item);
    } else {
      seen.add(key);
      firstByHost.push(item);
    }
  });

  const out: T[] = [];
  const perHost = new Map<string, number>();
  for (const [index, item] of [...firstByHost, ...remainder].entries()) {
    if (out.length >= limit) break;
    const host = sourceHostname(urlOf(item));
    const key = host || `invalid:${index}`;
    const used = perHost.get(key) ?? 0;
    if (used >= maxPerHost) continue;
    perHost.set(key, used + 1);
    out.push(item);
  }
  return out;
}
