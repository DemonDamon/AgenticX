import type { Message } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";

const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/** 单条消息写入剪贴板用的纯文本：去掉推理标签可见部分，并展开粘连 Markdown。 */
export function messagePlainTextForClipboard(message: Pick<Message, "content" | "role">): string {
  let t = message.content || "";
  if (message.role === "assistant") {
    const parsed = parseReasoningContent(t);
    if (parsed.hasReasoningTag) t = parsed.response || t;
  }
  return expandMarkdownPlainTextForCopy(t);
}

/**
 * 将模型常输出的「单行粘连」Markdown 展开为更易读的纯文本换行，便于复制到笔记/微信等。
 * 不解析完整 AST，只做保守启发式；fenced code 内不改动。
 */
export function expandMarkdownPlainTextForCopy(raw: string): string {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text) return text;
  const chunks = text.split(FENCED_BLOCK_RE);
  const out = chunks.map((chunk, idx) => (idx % 2 === 1 ? chunk : expandChunk(chunk)));
  return out.join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function expandChunk(chunk: string): string {
  let t = chunk;
  // --- 与 ### 粘在一起（如 ---### 标题）
  t = t.replace(/-{3,}\s*(#{1,6}\s+)/g, "---\n\n$1");
  // 非行首的 ATX 标题：句号/分号/括号等后紧跟 # 标题
  t = t.replace(/([\u3002\uff0c\uff1b\u3001!?.）\)])\s*(#{1,6}\s+)/g, "$1\n\n$2");
  // 任意非换行、非 # 字符后紧跟 ATX 标题（修复「正文### 标题」一行）
  t = t.replace(/([^\n#])(#{1,6}\s+)/g, "$1\n\n$2");
  // Markdown 表格行被压成 `||` 分隔
  t = t.replace(/\|\|/g, "|\n|");
  // 中文标点后直接接列表符
  t = t.replace(/([\u3002\uff0c\uff1b\u3001!?.])\s*(-\s+\S)/g, "$1\n$2");
  return t;
}
