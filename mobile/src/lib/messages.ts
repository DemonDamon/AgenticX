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
  | { kind: "pending"; key: string };

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
