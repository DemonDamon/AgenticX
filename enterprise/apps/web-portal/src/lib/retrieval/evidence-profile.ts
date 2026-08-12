import { sourceHostname } from "./source-diversity";

export type EvidenceSource = {
  url: string;
  publishedAt?: string;
};

export type EvidenceFacetSummary = {
  query: string;
  selectedHits: number;
  uniqueHosts: number;
  /** Publication dates exposed by providers; not the time states discussed in page content. */
  datedSources: number;
  coverage: "covered" | "missing";
  dateFrom?: string;
  dateTo?: string;
};

function normalizedDay(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/** Summarize only evidence that is actually available to the answer model. */
export function summarizeEvidenceFacet(
  query: string,
  sources: EvidenceSource[],
): EvidenceFacetSummary {
  const hosts = new Set(sources.map((source) => sourceHostname(source.url)).filter(Boolean));
  const days = [
    ...new Set(
      sources
        .map((source) => normalizedDay(source.publishedAt))
        .filter((day): day is string => Boolean(day)),
    ),
  ].sort();
  return {
    query,
    selectedHits: sources.length,
    uniqueHosts: hosts.size,
    datedSources: days.length,
    coverage: sources.length > 0 ? "covered" : "missing",
    ...(days[0] ? { dateFrom: days[0] } : {}),
    ...(days.at(-1) ? { dateTo: days.at(-1) } : {}),
  };
}

/**
 * Inject only actionable gaps. Full counts live in retrieval trace so the answer
 * prompt does not repeat long facet queries or imply provider metadata proves a trend.
 */
export function formatEvidenceCoverage(summaries: EvidenceFacetSummary[]): string {
  if (summaries.length === 0) return "";
  const warnings = summaries.flatMap((summary, index) => {
    const label = `子问题 ${index + 1}`;
    if (summary.selectedHits === 0) return [`${label} 无可用来源`];
    return summary.uniqueHosts < 2
      ? [`${label} 仅 ${summary.uniqueHosts} 个来源域名`]
      : [];
  });
  if (warnings.length === 0) return "";
  return (
    `证据覆盖提醒：${warnings.join("；")}。` +
    "来源域名不等于独立信源；趋势仍须从正文验证可比时间状态，证据不足时降级措辞。"
  );
}
