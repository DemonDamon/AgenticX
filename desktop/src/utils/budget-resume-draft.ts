import type { Message } from "../store";
import { parseTodoMessage } from "../components/TodoUpdateCard";
import { assistantBodyText } from "./budget-incomplete-message";

const ASSISTANT_SNIPPET_MAX = 600;
const ASSISTANT_SNIPPET_COUNT = 3;
const TOOL_PATHS_MAX = 30;

function truncate(text: string, maxLen: number): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/** Collect deduped (order-preserving) `path` args from tool messages matching toolNames. */
function collectToolPaths(
  messages: Message[],
  toolNames: readonly string[],
): string[] {
  const wanted = new Set(toolNames);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.toolName || !wanted.has(msg.toolName)) continue;
    const raw = (msg.toolArgs as { path?: unknown } | undefined)?.path;
    const path = String(raw ?? "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function formatPathList(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length <= TOOL_PATHS_MAX) {
    return paths.map((p) => `- ${p}`).join("\n");
  }
  const head = paths.slice(0, TOOL_PATHS_MAX).map((p) => `- ${p}`).join("\n");
  return `${head}\n- …等共 ${paths.length} 个文件`;
}

function findLastTodoWrite(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    const parsed = parseTodoMessage(msg.content);
    if (!parsed) continue;
    const lines = parsed.items.map((item) => {
      const status =
        item.status === "completed"
          ? "已完成"
          : item.status === "in_progress"
            ? "进行中"
            : "待办";
      return `- [${status}] ${item.content}`;
    });
    if (lines.length === 0) return null;
    return lines.join("\n");
  }
  return null;
}

function findFirstUserGoal(messages: Message[]): string | null {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = String(msg.content ?? "").trim();
    if (text) return truncate(text, ASSISTANT_SNIPPET_MAX);
  }
  return null;
}

function findRecentAssistantSummaries(messages: Message[]): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    const body = assistantBodyText(msg);
    if (!body) continue;
    out.push(truncate(body, ASSISTANT_SNIPPET_MAX));
    if (out.length >= ASSISTANT_SNIPPET_COUNT) break;
  }
  return out.reverse();
}

export function buildBudgetResumeDraft(messages: Message[]): string {
  const sections: string[] = [];
  const goal = findFirstUserGoal(messages);
  if (goal) {
    sections.push(`【原始目标】\n${goal}`);
  }
  const todo = findLastTodoWrite(messages);
  if (todo) {
    sections.push(`【待办列表】\n${todo}`);
  }
  const producedFiles = formatPathList(collectToolPaths(messages, ["file_write", "file_edit"]));
  if (producedFiles) {
    sections.push(`【已产出文件】\n${producedFiles}`);
  }
  const readFiles = formatPathList(collectToolPaths(messages, ["file_read"]));
  if (readFiles) {
    sections.push(`【已读文件】\n${readFiles}`);
  }
  const summaries = findRecentAssistantSummaries(messages);
  if (summaries.length > 0) {
    sections.push(`【上次产出摘要】\n${summaries.map((s, idx) => `${idx + 1}. ${s}`).join("\n\n")}`);
  }
  sections.push(
    "请基于以上信息继续未完成的工作，不要重新开始；已读文件无需重读，已产出文件在其基础上继续完善。",
  );
  return sections.join("\n\n");
}
