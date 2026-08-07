/**
 * P3 deliverable writers: mindmap + HTML (+ markdown copy) after synthesize.
 * Kept separate from orchestrator to minimize merge conflicts with P2.
 */

import type { DeepResearchEvent } from "@agenticx/sdk-ts";
import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACTS_PER_RUN,
  type ArtifactStore,
} from "./artifact-store";
import {
  DEFAULT_DELIVERY_PREFS,
  primaryArtifactTitle,
  sanitizeResearchTopic,
  type DeliveryPrefs,
} from "./delivery-prefs";
import type { Citation } from "./registry";
import { markdownToHtml, renderHtmlReport } from "./report-html";
import { buildMindmap } from "./report-mindmap";
import { linkifyCitations, type ReportOutline } from "./report-writer";

export type ResearchStats = {
  queriesPlanned: number;
  urlsDiscovered: number;
  sourcesSelected: number;
  pagesFetched: number;
};

export type FinalizeReportArtifactsInput = {
  artifactStore: ArtifactStore;
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  topic: string;
  outline: ReportOutline;
  markdown: string;
  citations: Citation[];
  stats?: ResearchStats;
  sectionKeyPoints?: Record<string, string[]>;
  artifactsWritten: number;
  /** Controls HTML title; report.md duplicate is never written. */
  deliveryPrefs?: DeliveryPrefs;
  enqueueEvent: (event: DeepResearchEvent) => void;
  now?: () => Date;
};

/** Sanitize download filename: keep CJK/latin/digits/_-, else `_`; max 80; empty → research-report. */
export function safeFilename(title: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "") || "bin";
  let base = title
    .normalize("NFKC")
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!base) base = "research-report";
  if (base.length > 80) base = base.slice(0, 80);
  return `${base}.${cleanExt}`;
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function buildCompactHtml(input: {
  title: string;
  topic: string;
  markdown: string;
  citations: Citation[];
  stats?: ResearchStats;
  generatedAt: string;
}): string {
  let body = input.markdown;
  const note = "\n\n> 报告体积较大，可视化版本已精简（省略思维导图并截断正文）。\n";
  // Binary search-ish truncate until under budget with headroom for chrome.
  let lo = 0;
  let hi = body.length;
  let best = renderHtmlReport({
    title: input.title,
    topic: input.topic,
    markdown: note,
    citations: input.citations,
    mindmapMermaid: "",
    stats: input.stats,
    generatedAt: input.generatedAt,
  });
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = renderHtmlReport({
      title: input.title,
      topic: input.topic,
      markdown: body.slice(0, mid) + note,
      citations: input.citations,
      mindmapMermaid: "",
      stats: input.stats,
      generatedAt: input.generatedAt,
    });
    if (byteLength(candidate) <= MAX_ARTIFACT_BYTES) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function buildCompactWordDoc(title: string, markdown: string): string {
  const note = "\n\n> 报告体积较大，Word 版本已截断正文。\n";
  let lo = 0;
  let hi = markdown.length;
  let best = renderWordHtmlDocument(title, markdownToHtml(note).html);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = renderWordHtmlDocument(
      title,
      markdownToHtml(markdown.slice(0, mid) + note).html,
    );
    if (byteLength(candidate) <= MAX_ARTIFACT_BYTES) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Write report.html (+ report.doc when Word is primary) after final report is ready.
 * Markdown body lives in final-report.md (orchestrator); do not duplicate as report.md.
 * Returns updated artifactsWritten count.
 */
export async function finalizeReportArtifacts(
  input: FinalizeReportArtifactsInput,
): Promise<number> {
  let written = input.artifactsWritten;
  if (!input.sessionId || !input.tenantId || !input.userId) return written;

  const validIndexes = new Set(input.citations.map((c) => c.index));
  const linkified = linkifyCitations(input.markdown, validIndexes);
  const title = sanitizeResearchTopic(input.outline.title || input.topic || "调研报告");
  const topic = sanitizeResearchTopic(input.topic || title);
  const generatedAt = (input.now?.() ?? new Date()).toISOString();
  const prefs = input.deliveryPrefs ?? DEFAULT_DELIVERY_PREFS;

  // Word is a primary deliverable when user picked docx. Never skip solely because
  // lane memos already hit MAX_ARTIFACTS_PER_RUN.
  if (prefs.format === "docx") {
    let doc = renderWordHtmlDocument(title, markdownToHtml(linkified).html);
    if (byteLength(doc) > MAX_ARTIFACT_BYTES) {
      doc = buildCompactWordDoc(title, linkified);
    }
    const docRecord = await input.artifactStore.write({
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId: input.sessionId,
      runId: input.runId,
      path: `research/${input.runId}/report.doc`,
      title: primaryArtifactTitle(topic, prefs),
      kind: "report",
      mimeType: "application/vnd.ms-word",
      content: doc,
    });
    written += 1;
    input.enqueueEvent({
      type: "artifact",
      id: docRecord.id,
      path: docRecord.path,
      title: docRecord.title,
      kind: "report",
      bytes: docRecord.byteSize,
    });
  }

  const mindmapMermaid = buildMindmap({
    topic,
    outline: input.outline,
    sectionKeyPoints: input.sectionKeyPoints,
  });

  let html = renderHtmlReport({
    title,
    topic,
    markdown: linkified,
    citations: input.citations,
    mindmapMermaid,
    stats: input.stats,
    generatedAt,
  });
  if (byteLength(html) > MAX_ARTIFACT_BYTES) {
    html = buildCompactHtml({
      title,
      topic,
      markdown: linkified,
      citations: input.citations,
      stats: input.stats,
      generatedAt,
    });
  }

  // HTML is a primary deliverable (especially when user picked html/pdf). Never
  // skip it solely because lane memos already hit MAX_ARTIFACTS_PER_RUN.
  const mustWriteHtml =
    prefs.format === "html" || prefs.format === "pdf" || written < MAX_ARTIFACTS_PER_RUN;
  if (!mustWriteHtml) return written;

  const htmlTitle = primaryArtifactTitle(topic, {
    ...prefs,
    format: prefs.format === "pdf" || prefs.format === "html" ? prefs.format : "html",
  });
  // Always use .html title for the HTML artifact path (even when md/docx is primary).
  const artifactTitle =
    prefs.format === "html" || prefs.format === "pdf"
      ? htmlTitle
      : `${topic.trim() || "调研报告"}.html`;

  const record = await input.artifactStore.write({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    runId: input.runId,
    path: `research/${input.runId}/report.html`,
    title: artifactTitle,
    kind: "report",
    mimeType: "text/html",
    content: html,
  });
  written += 1;
  input.enqueueEvent({
    type: "artifact",
    id: record.id,
    path: record.path,
    title: record.title,
    kind: "report",
    bytes: record.byteSize,
  });

  return written;
}

/** Word-compatible HTML wrapper (opened as .doc). */
export function renderWordHtmlDocument(title: string, bodyHtml: string): string {
  const safeTitle = escapeForWord(title);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.6; }
h1,h2,h3 { color: #3730a3; }
a { color: #4f46e5; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeForWord(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
