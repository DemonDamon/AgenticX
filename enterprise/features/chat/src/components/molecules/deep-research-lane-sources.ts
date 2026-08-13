/**
 * Lane source helpers for the deep-research workbench.
 *
 * Lane rows used to dump raw progress prose; these turn the same events into
 * a metric strip plus a clickable source list.
 */

export type LaneSource = {
  title: string;
  url: string;
  snippet?: string;
  /** Artifact path of the archived full text, when the page was fetched. */
  archivedPath?: string;
  fetched?: boolean;
};

export type LaneMetric = {
  key: "queries" | "found" | "adopted" | "pages" | "capped";
  text: string;
  tone: "default" | "warning";
};

/** Readable host for a source URL, minus the `www.` prefix. */
export function laneSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function firstNumber(joined: string, re: RegExp): number | null {
  const match = joined.match(re);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Turn the Chinese progress lines into plain-language chips.
 *
 * 采用 must come from the 已收集 line rather than 筛选出: a lane scores and
 * shortlists candidates, then adds them to the run-wide registry, which stops
 * at MAX_SOURCES. Late lanes therefore shortlist 10 but adopt far fewer (or
 * none), so reading 筛选出 made every lane claim the same count.
 */
export function parseLaneMetrics(detailLines: string[]): LaneMetric[] {
  if (detailLines.length === 0) return [];
  const joined = detailLines.join("\n");

  // A lane may stop early once candidates outnumber what it can adopt, so the
  // expanded count overstates spend — prefer the line reporting what actually ran.
  const expanded = firstNumber(joined, /已展开\s*(\d+)\s*条检索式/u);
  const actuallyRan = firstNumber(joined, /实际检索\s*(\d+)\s*条/u);
  const queries = actuallyRan ?? expanded;
  const found = firstNumber(joined, /发现\s*(\d+)\s*个候选来源/u);
  const shortlisted = firstNumber(joined, /筛选出\s*(\d+)\s*\/\s*\d+\s*个高质量来源/u);
  const collected = firstNumber(joined, /已收集\s*(\d+)\s*个来源/u);
  const pages = firstNumber(joined, /已读取\s*(\d+)\s*\/\s*\d+\s*篇正文/u);
  const adopted = collected ?? shortlisted;

  const out: LaneMetric[] = [];
  if (queries !== null) {
    out.push({ key: "queries", text: `搜索 ${queries} 次`, tone: "default" });
  }
  if (found !== null) {
    out.push({ key: "found", text: `找到 ${found} 个网页`, tone: "default" });
  }
  if (adopted !== null) {
    out.push({ key: "adopted", text: `采用 ${adopted} 个`, tone: "default" });
  }
  if (pages !== null && pages > 0) {
    out.push({ key: "pages", text: `读取正文 ${pages} 篇`, tone: "default" });
  }
  // Shortlisted but not adopted can only mean the run-wide source budget ran
  // out — say so, or a red lane reads like a failed search.
  if (shortlisted !== null && collected !== null && collected < shortlisted) {
    out.push({ key: "capped", text: "已达来源上限", tone: "warning" });
  }
  return out;
}
