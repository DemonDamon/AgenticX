import type { SearchReference } from "../types/search-references";

/** Strip legacy score metadata lines prepended to KB snippets. */
export function formatReferenceSnippet(ref: SearchReference | undefined): string {
  const raw = String(ref?.snippet ?? "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const body: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (body.length > 0) body.push("");
      continue;
    }
    if (/^score=[\d.]+/i.test(t)) continue;
    if (/^(fused|vec|bm25)=[\d.]+/i.test(t)) continue;
    if (/^(fused|vec|bm25)=[\d.]+\s*·/i.test(t)) continue;
    body.push(line);
  }
  return body.join("\n").trim();
}
