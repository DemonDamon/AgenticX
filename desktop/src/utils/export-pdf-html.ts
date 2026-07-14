import { marked } from "marked";
import type { Message, MessageAttachment } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { expandMessagesToTopLevelRows } from "../components/messages/react-blocks";
import { resolveMetaDisplayName } from "./display-name";
import { isShowWidgetToolMessage, parseWidgetPayload } from "../components/messages/widget-preview";

const PDF_STYLES = `
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: #fff;
    color: #111;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  .doc-header { margin-bottom: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; }
  .doc-header h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
  .doc-header .subtitle { margin: 0 0 4px; color: #374151; font-size: 15px; }
  .doc-header .meta-line { margin: 0; color: #6b7280; font-size: 12px; }
  /* Allow tall messages (tables / long markdown / SVG) to paginate across pages.
   * page-break-inside:avoid on oversized blocks caused blank trailing pages and
   * dropped the real final answer in Chromium printToPDF. */
  .msg {
    margin-bottom: 16px;
    padding: 12px 12px 12px 14px;
    border-left: 3px solid #d1d5db;
    page-break-inside: auto;
    break-inside: auto;
  }
  .msg.user { border-left-color: #2563eb; background: #f8fafc; }
  .msg.assistant { border-left-color: #9ca3af; background: #fafafa; }
  .msg .meta { margin-bottom: 8px; font-size: 12px; color: #4b5563; }
  .msg .meta .who { font-weight: 600; margin-right: 8px; }
  .msg .body :first-child { margin-top: 0; }
  .msg .body :last-child { margin-bottom: 0; }
  .msg .body pre {
    background: #f3f4f6;
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
  .msg .body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    background: #f3f4f6;
    padding: 1px 4px;
    border-radius: 4px;
  }
  .msg .body table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  .msg .body th, .msg .body td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
  .msg .body th { background: #f3f4f6; }
  .attachments { margin-top: 10px; }
  .attachments img { max-width: 100%; height: auto; border-radius: 6px; margin-top: 8px; display: block; }
  .msg.widget { border-left-color: #9ca3af; background: #fafafa; }
  .widget-title { margin: 0 0 8px; font-size: 12px; color: #4b5563; font-weight: 600; }
  .widget-graphic { width: 100%; }
  .widget-graphic svg { width: 100%; height: auto; display: block; }
  .widget-fallback { color: #6b7280; font-size: 12px; font-style: italic; }
`;

/** Sane print-safe defaults so widget SVGs referencing app theme vars (e.g. `rgb(var(--theme-color-rgb))`)
 * still render correctly when the exported HTML is opened outside the live app (no computed styles). */
const WIDGET_THEME_VAR_DEFAULTS = `
  :root {
    --text-primary: #111827;
    --text-strong: #111827;
    --text-muted: #4b5563;
    --text-subtle: #6b7280;
    --text-faint: #9ca3af;
    --surface-base: #ffffff;
    --surface-card: #f9fafb;
    --surface-card-strong: #f3f4f6;
    --border-subtle: #e5e7eb;
    --border-strong: #d1d5db;
    --theme-color-rgb: 37, 99, 235;
    --theme-color-text: #2563eb;
    --status-success: #22c55e;
    --status-warning: #f59e0b;
    --status-error: #ef4444;
  }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Pure `<think>…</think>` process scraps — UI collapses these; do not dump as fake replies. */
export function isThinkOnlyAssistantMessage(message: Message): boolean {
  if (message.role !== "assistant") return false;
  const parsed = parseReasoningContent(message.content || "");
  if (!parsed.hasReasoningTag) return false;
  return parsed.response.trim().length === 0;
}

/** Export keeps user/assistant answers + `show_widget` graphics. Other tools and
 * think-only assistant scraps are dropped so the PDF matches the visible conversation. */
function isExportableMessage(message: Message): boolean {
  if (message.role === "tool") return isShowWidgetToolMessage(message);
  if (isThinkOnlyAssistantMessage(message)) return false;
  return true;
}

/**
 * If any message inside a ReAct turn is selected, include the whole turn
 * (preceding user row + all work messages) so the final answer / widget cannot
 * be left out of a partial multi-select.
 */
export function expandSelectionForCompletePdfExport(
  selected: Message[],
  allVisible: Message[],
): Message[] {
  if (selected.length === 0) return [];
  if (allVisible.length === 0) return selected;

  const selectedIds = new Set(selected.map((m) => m.id));
  const includeIds = new Set<string>(selectedIds);
  const rows = expandMessagesToTopLevelRows(allVisible);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "react") continue;
    const blockMsgs = [
      ...row.block.workMessages,
      ...(row.block.finalAssistant ? [row.block.finalAssistant] : []),
    ];
    const blockHit = blockMsgs.some((m) => selectedIds.has(m.id));
    const prev = i > 0 ? rows[i - 1] : null;
    const userHit = prev?.kind === "user" && selectedIds.has(prev.message.id);
    if (!blockHit && !userHit) continue;
    for (const m of blockMsgs) includeIds.add(m.id);
    if (prev?.kind === "user") includeIds.add(prev.message.id);
  }

  return allVisible.filter((m) => includeIds.has(m.id));
}

function resolveSender(message: Message, userBubbleLabel: string): string {
  if (message.role === "user") return userBubbleLabel.trim() || "我";
  const raw = String(message.avatarName || message.agentId || "AI").trim();
  if (!raw) return "AI";
  return resolveMetaDisplayName(raw.toLowerCase() === "meta" ? null : raw);
}

/** Renders a `show_widget` tool message as its actual graphic (SVG inlined verbatim — safe
 * because the offscreen export window has `javascript: false`, so embedded scripts cannot
 * execute even if present). Non-SVG widgets (interactive HTML / stock_chart) cannot be
 * faithfully rendered without a script runtime, so they fall back to a labeled placeholder. */
function widgetBlockHtml(message: Message): string {
  const payload = parseWidgetPayload(message.content || "");
  if (!payload) {
    return `<div class="widget-fallback">[图表内容解析失败，无法导出]</div>`;
  }
  if (payload.kind === "stock_chart") {
    const title = escapeHtml(payload.title || "行情图表");
    return `<div class="widget-fallback">[图表：${title}]（交互式行情图表暂不支持导出为静态图片，请在应用内查看）</div>`;
  }
  const title = payload.title ? `<p class="widget-title">${escapeHtml(payload.title)}</p>` : "";
  if (payload.kind === "svg") {
    return `${title}<div class="widget-graphic">${payload.widgetCode}</div>`;
  }
  return `${title}<div class="widget-fallback">[图表基于交互脚本渲染，暂不支持导出为静态图片，请在应用内查看]</div>`;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExportDate(exportedAt: number): string {
  return new Date(exportedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageBodyHtml(message: Message): string {
  let content = message.content || "";
  if (message.role === "assistant") {
    const parsed = parseReasoningContent(content);
    // Never fall back to raw `<think>` text — that leaked process scraps into the PDF.
    if (parsed.hasReasoningTag) content = parsed.response;
  }
  content = content.trim();
  if (!content) return "";
  return marked.parse(content, { async: false }) as string;
}

function attachmentImagesHtml(attachments?: MessageAttachment[]): string {
  if (!attachments?.length) return "";
  const parts: string[] = [];
  for (const att of attachments) {
    if (!att.mimeType.startsWith("image/")) continue;
    const alt = escapeHtml(att.name || "image");
    if (att.dataUrl) {
      parts.push(`<img src="${att.dataUrl}" alt="${alt}" />`);
      continue;
    }
    if (att.sourcePath) {
      const normalized = att.sourcePath.replace(/\\/g, "/");
      const fileUrl = normalized.startsWith("file://") ? normalized : `file://${normalized}`;
      parts.push(`<img src="${fileUrl}" alt="${alt}" />`);
    }
  }
  if (!parts.length) return "";
  return `<div class="attachments">${parts.join("")}</div>`;
}

function hasAttachmentImages(attachments?: MessageAttachment[]): boolean {
  return Boolean(attachments?.some((att) => att.mimeType.startsWith("image/")));
}

export function buildMessagesPdfHtml(args: {
  messages: Message[];
  sessionTitle?: string;
  exportedAt: number;
  userBubbleLabel?: string;
}): string {
  const { messages, sessionTitle, exportedAt, userBubbleLabel = "我" } = args;
  const exportable = messages.filter(isExportableMessage);
  const title = escapeHtml(sessionTitle?.trim() || "对话记录");
  const exportDate = escapeHtml(formatExportDate(exportedAt));

  const rendered = exportable
    .map((message) => {
      const isWidget = message.role === "tool";
      const who = escapeHtml(resolveSender(message, userBubbleLabel));
      const time = escapeHtml(formatTime(message.timestamp));
      const roleClass = isWidget ? "msg widget" : message.role === "user" ? "msg user" : "msg assistant";
      const body = isWidget ? widgetBlockHtml(message) : messageBodyHtml(message);
      const images = isWidget ? "" : attachmentImagesHtml(message.attachments);
      if (!body && !images) return null;
      return `
      <section class="${roleClass}">
        ${isWidget ? "" : `<div class="meta"><span class="who">${who}</span>${time ? `<span class="time">${time}</span>` : ""}</div>`}
        ${body ? `<div class="body">${body}</div>` : ""}
        ${images}
      </section>`;
    })
    .filter((block): block is string => Boolean(block));

  const count = rendered.length;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Near 对话记录</title>
<style>${WIDGET_THEME_VAR_DEFAULTS}${PDF_STYLES}</style>
</head>
<body>
<header class="doc-header">
  <h1>Near 对话记录</h1>
  <p class="subtitle">${title}</p>
  <p class="meta-line">导出时间：${exportDate} · 共 ${count} 条消息</p>
</header>
<main>${rendered.join("\n")}</main>
</body>
</html>`;
}

/** Test helper: whether a message would contribute a body/images section. */
export function messageContributesToPdfExport(message: Message): boolean {
  if (!isExportableMessage(message)) return false;
  if (message.role === "tool") return true;
  if (messageBodyHtml(message)) return true;
  return hasAttachmentImages(message.attachments);
}
