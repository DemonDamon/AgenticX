import type { MobileMessage } from "../api/types";

/** 工具分组卡里的单步 */
export interface ToolStep {
  toolName: string;
  status: "done" | "error" | "unknown";
  /** bash_exec → command；其它工具 → 参数 JSON 摘要 */
  detail: string;
  /** 结果 content 单行截断预览 */
  resultPreview: string;
}

/** 消息流渲染条目（inverted FlatList 的 data 源） */
export type ChatEntry =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning?: string }
  | { kind: "system"; key: string; text: string }
  | { kind: "toolGroup"; key: string; steps: ToolStep[] }
  /** 本地发送中占位（仅页面内使用，不进 buildChatEntries） */
  | { kind: "pending"; key: string }
  /** 真流式：回合进行中的 token 增量气泡（WS turn_delta 累积） */
  | { kind: "streaming"; key: string; text: string };

const RESULT_PREVIEW_MAX = 120;

function readText(m: MobileMessage): string {
  const raw = typeof m.text === "string" ? m.text : m.content;
  return typeof raw === "string" ? raw : "";
}

function readToolName(m: MobileMessage): string {
  const raw = m.tool_name ?? m.name;
  return typeof raw === "string" && raw.trim() !== "" ? raw : "tool";
}

function readToolStatus(m: MobileMessage): ToolStep["status"] {
  if (m.tool_status === "done") return "done";
  if (m.tool_status === "error") return "error";
  return "unknown";
}

function toolDetail(m: MobileMessage): string {
  const args = m.tool_args;
  if (args !== null && typeof args === "object") {
    const cmd = (args as Record<string, unknown>).command;
    if (typeof cmd === "string" && cmd.trim() !== "") return cmd.trim();
    try {
      return JSON.stringify(args).slice(0, RESULT_PREVIEW_MAX);
    } catch {
      return "";
    }
  }
  return "";
}

function resultPreview(m: MobileMessage): string {
  const raw = typeof m.content === "string" ? m.content : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, RESULT_PREVIEW_MAX);
}

/**
 * 后端消息线 → 手机端渲染条目：
 * - 连续 tool 消息归入一个 toolGroup（遇 user/assistant/system 断组）
 * - assistant 携带 reasoning 供「思考过程」折叠块
 * - 老消息（无 tool 字段）按纯文本回退
 */
export function buildChatEntries(messages: MobileMessage[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let group: ToolStep[] | null = null;

  const flush = () => {
    if (group !== null && group.length > 0) {
      entries.push({ kind: "toolGroup", key: `tg-${entries.length}`, steps: group });
    }
    group = null;
  };

  messages.forEach((m, i) => {
    if (m.role === "tool") {
      if (group === null) group = [];
      group.push({
        toolName: readToolName(m),
        status: readToolStatus(m),
        detail: toolDetail(m),
        resultPreview: resultPreview(m),
      });
      return;
    }
    flush();
    const text = readText(m);
    const key = `${i}-${m.role}-${m.ts ?? "nots"}`;
    if (m.role === "user") {
      entries.push({ kind: "user", key, text });
    } else if (m.role === "assistant") {
      const reasoning =
        typeof m.reasoning === "string" && m.reasoning.trim() !== ""
          ? m.reasoning.trim()
          : undefined;
      entries.push({ kind: "assistant", key, text, reasoning });
    } else {
      entries.push({ kind: "system", key, text });
    }
  });
  flush();
  return entries;
}

/**
 * 应用一帧流式增量：首个 delta 把 pending 占位原位替换为 streaming
 * 气泡，后续 delta 追加文本。pending 已被移除（如轮询快照重建过）时
 * 尾部追加。返回新数组（输入不变）。
 */
export function applyStreamDelta(
  entries: ChatEntry[] | null,
  pendingKey: string,
  delta: string,
): ChatEntry[] {
  const list = entries ?? [];
  if (delta === "") return list;
  const streamKey = `stream-${pendingKey}`;
  const streamIdx = list.findIndex((e) => e.key === streamKey);
  if (streamIdx >= 0) {
    const cur = list[streamIdx];
    if (cur.kind === "streaming") {
      const next = [...list];
      next[streamIdx] = { ...cur, text: cur.text + delta };
      return next;
    }
  }
  const pendingIdx = list.findIndex((e) => e.key === pendingKey);
  if (pendingIdx >= 0) {
    const next = [...list];
    next[pendingIdx] = { kind: "streaming", key: streamKey, text: delta };
    return next;
  }
  return [...list, { kind: "streaming", key: streamKey, text: delta }];
}

/**
 * streaming 气泡的可见文本：token 流里的思考段有两种形态——
 * ① 后端 safe_stream 规范化的 ` Mattis`/` Mattis/`（模型输出 `< think >`
 *   等非规范变体时被规范成 Mattis 下发）；② parser 不识别的变体
 * （`<thinking>`）原文透传。两种都要剥除，终态由结构化替换渲染思考
 * 折叠，streaming 阶段只外显答案部分。完整闭合块、流式进行中的未闭合
 * 尾部、以及被 delta 分片截断的标签前缀（尾部 "<" / "<thi" 等）一并
 * 剥除——截断前缀只会让该字符晚一帧出现，不会丢失。
 */
const THINK_BLOCK_RE = /<(think|thinking)>[\s\S]*?(?:<\/\1>|$)/g;
const THINK_OPEN_PREFIXES = ["<think>", "<thinking>"];

export function visibleStreamText(text: string): string {
  let visible = text.replace(THINK_BLOCK_RE, "");
  for (let n = Math.min(9, visible.length); n > 0; n -= 1) {
    const tail = visible.slice(-n);
    if (THINK_OPEN_PREFIXES.some((p) => p.slice(0, n) === tail)) {
      visible = visible.slice(0, -n);
      break;
    }
  }
  return visible;
}
