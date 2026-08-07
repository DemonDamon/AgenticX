/**
 * Client-side helpers to pick the primary deep-research delivery card.
 * Mirrors portal delivery-prefs format ids without importing web-portal.
 */

export type ClientDeliveryFormat = "md" | "html" | "docx" | "pdf";

const FORMAT_QUESTION_ID = "q_delivery_format";

/** Infer primary format from persisted clarify answers (label / id / keyword). */
export function inferDeliveryFormat(
  clarifyAnswers?: Record<string, string> | null,
): ClientDeliveryFormat {
  const raw = clarifyAnswers?.[FORMAT_QUESTION_ID]?.trim() ?? "";
  if (!raw) return "md";
  const lower = raw.toLowerCase();
  if (lower === "html" || raw.includes("可视化网页") || lower.includes(".html")) {
    return "html";
  }
  if (lower === "pdf" || raw.includes("PDF") || raw.includes("打印")) return "pdf";
  if (lower === "docx" || raw.includes("Word") || lower.includes(".doc")) return "docx";
  if (lower === "md" || raw.includes("Markdown") || lower.includes(".md")) return "md";
  return "md";
}

export function primaryReportBasename(format: ClientDeliveryFormat): string {
  if (format === "html" || format === "pdf") return "report.html";
  if (format === "docx") return "report.doc";
  return "final-report.md";
}

export function isPrimaryDeliveryArtifactPath(
  path: string,
  format: ClientDeliveryFormat,
): boolean {
  const base = path.toLowerCase().split("/").pop() || path.toLowerCase();
  if (base === "report.md") return false;
  const want = primaryReportBasename(format);
  return base === want;
}

/** Strip legacy 「· 终稿」style suffixes from artifact titles. */
export function cleanDeliveryArtifactTitle(title: string): string {
  return title.replace(/\s*·\s*(终稿|Markdown|可视化报告)\s*$/u, "").trim();
}

export function displayDeliveryFileName(input: {
  path: string;
  title: string;
}): string {
  const cleaned = cleanDeliveryArtifactTitle(input.title);
  const pathLower = input.path.toLowerCase();
  const ext = pathLower.endsWith(".html")
    ? ".html"
    : pathLower.endsWith(".doc")
      ? ".doc"
      : ".md";
  if (cleaned) {
    const lower = cleaned.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".html") || lower.endsWith(".doc")) {
      return cleaned;
    }
    return `${cleaned}${ext}`;
  }
  return input.path.split("/").pop()?.trim() || `report${ext}`;
}
