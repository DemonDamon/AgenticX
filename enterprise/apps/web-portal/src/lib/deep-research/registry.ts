/**
 * Global citation registry: dedupe by normalized URL across sub-questions.
 */

import type { WebSearchHit } from "../web-search/providers";

export type Citation = {
  index: number;
  title: string;
  url: string;
  snippet: string;
};

export function normalizeCitationUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    const dropKeys: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (key.toLowerCase().startsWith("utm_")) dropKeys.push(key);
    });
    for (const key of dropKeys) url.searchParams.delete(key);
    let href = url.toString();
    if (href.endsWith("/") && url.pathname !== "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return raw.trim().replace(/\/+$/, "").replace(/#.*$/, "");
  }
}

export class CitationRegistry {
  private readonly byKey = new Map<string, Citation>();
  private nextIndex = 1;

  add(hit: WebSearchHit): Citation {
    const key = normalizeCitationUrl(hit.url);
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const citation: Citation = {
      index: this.nextIndex,
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
    };
    this.nextIndex += 1;
    this.byKey.set(key, citation);
    return citation;
  }

  list(): Citation[] {
    return [...this.byKey.values()].sort((a, b) => a.index - b.index);
  }

  get size(): number {
    return this.byKey.size;
  }
}
