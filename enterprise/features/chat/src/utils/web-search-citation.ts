import type { WebSearchSource } from "@agenticx/core-api";

const CITATION_SPLIT_RE = /(\[(\d+)\])/g;

/** Hostname without leading www.; null if url is unusable. */
export function hostnameFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Short site label for citation pills.
 * Prefer registrable-ish label (e.g. venturebeat.com → VentureBeat-ish short form),
 * truncated when long; callers may still fall back to `[N]`.
 */
export function siteLabelFromSource(source: WebSearchSource | undefined, index1Based: number): string {
  if (!source?.url) return `[${index1Based}]`;
  const host = hostnameFromUrl(source.url);
  if (!host) return `[${index1Based}]`;
  const parts = host.split(".").filter(Boolean);
  // take the leftmost meaningful label for multi-level hosts (news.example.com → news)
  // but prefer second-level for classic domains (venturebeat.com → venturebeat)
  let label = host;
  if (parts.length >= 2) {
    const tld = parts[parts.length - 1] ?? "";
    const sld = parts[parts.length - 2] ?? "";
    if (tld.length <= 3 && sld.length > 1) {
      label = sld;
    } else {
      label = parts[0] ?? host;
    }
  }
  if (label.length > 18) {
    return `${label.slice(0, 16)}…`;
  }
  // Title-case-ish for display (venturebeat → Venturebeat)
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function resolveCitationSource(
  sources: WebSearchSource[] | undefined,
  index1Based: number,
): WebSearchSource | undefined {
  if (!sources?.length) return undefined;
  if (!Number.isInteger(index1Based) || index1Based < 1 || index1Based > sources.length) {
    return undefined;
  }
  return sources[index1Based - 1];
}

export type PartitionedSource = {
  source: WebSearchSource;
  /** 1-based index in the original sources array (for [N] highlight). */
  index1Based: number;
};

/** Split sources into model-used vs unused; legacy rows without the flag all count as used. */
export function partitionSourcesByUsage(sources: WebSearchSource[] | undefined): {
  used: PartitionedSource[];
  unused: PartitionedSource[];
} {
  if (!sources?.length) return { used: [], unused: [] };
  const hasFlag = sources.some((s) => typeof s.usedByModel === "boolean");
  const used: PartitionedSource[] = [];
  const unused: PartitionedSource[] = [];
  sources.forEach((source, index) => {
    const row = { source, index1Based: index + 1 };
    if (!hasFlag || source.usedByModel === true) used.push(row);
    else unused.push(row);
  });
  return { used, unused };
}

export type CitationMatch = {
  type: "text" | "citation";
  value: string;
  index1Based?: number;
};

/** Split plain text into text / citation tokens. Out-of-range [N] stays as text. */
export function splitCitationText(
  text: string,
  sources: WebSearchSource[] | undefined,
): CitationMatch[] {
  if (!text) return [];
  if (!sources?.length) {
    return [{ type: "text", value: text }];
  }
  const out: CitationMatch[] = [];
  let last = 0;
  CITATION_SPLIT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_SPLIT_RE.exec(text)) !== null) {
    const full = match[1] ?? "";
    const n = Number(match[2]);
    const start = match.index;
    if (start > last) {
      out.push({ type: "text", value: text.slice(last, start) });
    }
    if (resolveCitationSource(sources, n)) {
      out.push({ type: "citation", value: full, index1Based: n });
    } else {
      out.push({ type: "text", value: full });
    }
    last = start + full.length;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out.length > 0 ? out : [{ type: "text", value: text }];
}
