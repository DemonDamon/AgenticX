/**
 * Mermaid mindmap builder for deep-research reports.
 */

import type { ReportOutline } from "./report-writer";

export const MAX_MINDMAP_NODES = 40;
const MAX_NODE_CHARS = 24;

/** Strip characters that break Mermaid mindmap node text. */
export function sanitizeMindmapNodeText(raw: string): string {
  let text = raw
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_NODE_CHARS) {
    text = `${text.slice(0, MAX_NODE_CHARS - 1)}…`;
  }
  return text || "节点";
}

/**
 * Build Mermaid mindmap source from outline + optional per-section key points.
 * Empty outline → "".
 */
export function buildMindmap(input: {
  topic: string;
  outline: ReportOutline;
  /** 每节 2–4 个要点短语；缺失则只出标题层。 */
  sectionKeyPoints?: Record<string, string[]>;
}): string {
  const sections = input.outline.sections ?? [];
  if (sections.length === 0) return "";

  const root = sanitizeMindmapNodeText(input.topic || input.outline.title || "调研");
  const lines: string[] = ["mindmap", `  root((${root}))`];

  // Budget: root + one node per section, remainder for key points.
  let remaining = Math.max(0, MAX_MINDMAP_NODES - 1 - sections.length);

  for (const section of sections) {
    const title = sanitizeMindmapNodeText(section.title);
    lines.push(`    ${title}`);
    const points = input.sectionKeyPoints?.[section.id] ?? [];
    for (const point of points) {
      if (remaining <= 0) break;
      const cleaned = sanitizeMindmapNodeText(point);
      if (!cleaned) continue;
      lines.push(`      ${cleaned}`);
      remaining -= 1;
    }
  }

  return lines.join("\n");
}
