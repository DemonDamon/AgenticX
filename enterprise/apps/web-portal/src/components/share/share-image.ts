import { markdownToPlainText } from "@agenticx/feature-chat";
import {
  cleanChatShareContent,
  normalizeChatShareMessage,
  type ChatShareMessage,
  type ChatShareSnapshot,
} from "../../lib/chat-share-types";
import { ENTERPRISE_PRODUCT_NAME } from "../EnterpriseBrandMark";

const IMAGE_WIDTH = 1200;
const IMAGE_PADDING = 64;
const MAX_IMAGE_HEIGHT = 30_000;
const MAX_MESSAGE_CHARS = 12_000;
let imageShareInFlight: Promise<"downloaded"> | null = null;

export function prepareShareImageMessages(snapshot: ChatShareSnapshot): ChatShareMessage[] {
  return snapshot.messages
    .map((message) => normalizeChatShareMessage(message))
    .filter((message): message is ChatShareMessage => message !== null);
}

function toReadableImageText(raw: string): string {
  return markdownToPlainText(cleanChatShareContent(raw, { stripCitationMarkers: true }));
}

export function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

export async function createSharePng(snapshot: ChatShareSnapshot): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable");

  const contentWidth = IMAGE_WIDTH - IMAGE_PADDING * 2 - 48;
  const bodyFont = '28px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const lineHeight = 44;
  const prepared = prepareShareImageMessages(snapshot).map((message) => {
    const imageContent = toReadableImageText(message.content);
    const content = imageContent.length > MAX_MESSAGE_CHARS
      ? `${imageContent.slice(0, MAX_MESSAGE_CHARS)}…`
      : imageContent;
    context.font = bodyFont;
    return { message, lines: wrapCanvasText(context, content, contentWidth) };
  });
  const estimatedHeight =
    IMAGE_PADDING * 2 +
    112 +
    prepared.reduce((sum, item) => sum + 96 + item.lines.length * lineHeight + 32, 0);
  const height = Math.min(MAX_IMAGE_HEIGHT, Math.max(720, estimatedHeight));
  canvas.width = IMAGE_WIDTH;
  canvas.height = height;

  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, IMAGE_WIDTH, height);
  context.fillStyle = "#0f172a";
  context.font = 'bold 42px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const titleLines = wrapCanvasText(context, snapshot.title, IMAGE_WIDTH - IMAGE_PADDING * 2);
  let y = IMAGE_PADDING + 48;
  for (const line of titleLines.slice(0, 2)) {
    context.fillText(line, IMAGE_PADDING, y);
    y += 52;
  }
  context.fillStyle = "#64748b";
  context.font = '22px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`${ENTERPRISE_PRODUCT_NAME} · ${new Date(snapshot.created_at).toLocaleString("zh-CN")}`, IMAGE_PADDING, y + 8);
  y += 72;

  for (const item of prepared) {
    const availableHeight = height - IMAGE_PADDING - y;
    const visibleLineCount = Math.max(1, Math.floor((availableHeight - 64 - 28) / lineHeight));
    const lines = item.lines.length > visibleLineCount
      ? [...item.lines.slice(0, Math.max(1, visibleLineCount - 1)), "…"]
      : item.lines;
    const visibleCardHeight = 64 + lines.length * lineHeight + 28;
    const isUser = item.message.role === "user";
    const cardX = isUser ? IMAGE_PADDING + 48 : IMAGE_PADDING;
    const cardWidth = IMAGE_WIDTH - cardX - IMAGE_PADDING;
    context.fillStyle = isUser ? "#0ea5e9" : "#ffffff";
    roundedRect(context, cardX, y, cardWidth, visibleCardHeight, 24);
    context.fill();
    context.strokeStyle = isUser ? "#0ea5e9" : "#e2e8f0";
    context.lineWidth = 2;
    roundedRect(context, cardX, y, cardWidth, visibleCardHeight, 24);
    context.stroke();

    context.fillStyle = isUser ? "#e0f2fe" : "#64748b";
    context.font = 'bold 20px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(isUser ? "用户" : "助手", cardX + 24, y + 34);
    context.fillStyle = isUser ? "#ffffff" : "#1e293b";
    context.font = bodyFont;
    lines.forEach((line, index) => {
      context.fillText(line, cardX + 24, y + 78 + index * lineHeight);
    });
    y += visibleCardHeight + 24;
    if (lines.length < item.lines.length) break;
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("failed to create share image"));
    }, "image/png");
  });
}

/**
 * Download the same rendered share image from both the conversation page and
 * the public share page. Keep this deliberately separate from the Web Share
 * API: sharing a File through the system sheet produced duplicate/blank
 * images in the portal and does not match the share page experience.
 */
export async function downloadShareImage(
  snapshot: ChatShareSnapshot,
  filename = "agenticx-conversation.png",
): Promise<"downloaded"> {
  if (imageShareInFlight) return imageShareInFlight;

  const operation = (async (): Promise<"downloaded"> => {
    const blob = await createSharePng(snapshot);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return "downloaded";
  })();
  const settled = operation.finally(() => {
    if (imageShareInFlight === settled) imageShareInFlight = null;
  });
  imageShareInFlight = settled;
  return settled;
}
