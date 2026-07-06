import { marked } from "marked";
import type { Message, MessageAttachment } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { resolveMetaDisplayName } from "./display-name";

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
  .msg {
    margin-bottom: 16px;
    padding: 12px 12px 12px 14px;
    border-left: 3px solid #d1d5db;
    page-break-inside: avoid;
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
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveSender(message: Message, userBubbleLabel: string): string {
  if (message.role === "user") return userBubbleLabel.trim() || "我";
  if (message.role === "tool") return message.toolName || "tool";
  const raw = String(message.avatarName || message.agentId || "AI").trim();
  if (!raw) return "AI";
  return resolveMetaDisplayName(raw.toLowerCase() === "meta" ? null : raw);
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
    if (parsed.hasReasoningTag) content = parsed.response || content;
  }
  if (message.role === "tool") {
    const name = message.toolName || "tool";
    const result = content.trim();
    content = result ? `[${name}]\n${result}` : `[${name}]`;
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

export function buildMessagesPdfHtml(args: {
  messages: Message[];
  sessionTitle?: string;
  exportedAt: number;
  userBubbleLabel?: string;
}): string {
  const { messages, sessionTitle, exportedAt, userBubbleLabel = "我" } = args;
  const title = escapeHtml(sessionTitle?.trim() || "对话记录");
  const exportDate = escapeHtml(formatExportDate(exportedAt));
  const count = messages.length;

  const messageBlocks = messages
    .map((message) => {
      const who = escapeHtml(resolveSender(message, userBubbleLabel));
      const time = escapeHtml(formatTime(message.timestamp));
      const roleClass = message.role === "user" ? "msg user" : "msg assistant";
      const body = messageBodyHtml(message);
      const images = attachmentImagesHtml(message.attachments);
      return `
      <section class="${roleClass}">
        <div class="meta"><span class="who">${who}</span>${time ? `<span class="time">${time}</span>` : ""}</div>
        ${body ? `<div class="body">${body}</div>` : ""}
        ${images}
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Machi 对话记录</title>
<style>${PDF_STYLES}</style>
</head>
<body>
<header class="doc-header">
  <h1>Machi 对话记录</h1>
  <p class="subtitle">${title}</p>
  <p class="meta-line">导出时间：${exportDate} · 共 ${count} 条消息</p>
</header>
<main>${messageBlocks}</main>
</body>
</html>`;
}
