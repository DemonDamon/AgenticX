/**
 * Shared JSON extraction for LLM outputs.
 * Models emit <think> reasoning, ``` fences and stray prose around the payload;
 * every deep-research JSON call site must go through here before JSON.parse.
 */

import { stripThinkBlocks } from "./content-clean";

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

/** 找到第一个括号平衡的 JSON 片段，跳过字符串字面量与转义。找不到返回 null。 */
function sliceBalanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function pickJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(FENCE_RE)?.[1]?.trim();
  const candidate = fenced || trimmed;
  return sliceBalanced(candidate) ?? candidate;
}

/**
 * 剥离 think 与围栏，并截取首个平衡 JSON 片段。截不到时返回清理后的原文。
 *
 * stripThinkBlocks 对未闭合 <think> 会丢弃其后全部内容——那是正文语义。
 * JSON 场景下 payload 常落在未闭合的 think 尾部，所以主路径无果时改为
 * 只摘掉 think 标签本身再扫一次。
 */
export function extractJsonText(raw: string): string {
  const source = raw ?? "";
  const strict = pickJson(stripThinkBlocks(source));
  if (strict && sliceBalanced(strict)) return strict;

  const lenient = source
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ");
  return pickJson(lenient) ?? strict ?? "";
}

/** 解析 LLM 输出中的 JSON；失败返回 null，由调用方决定回落策略。 */
export function parseLlmJson<T = unknown>(raw: string): T | null {
  const text = extractJsonText(raw);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
