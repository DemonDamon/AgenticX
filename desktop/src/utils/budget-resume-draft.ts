import type { Message } from "../store";
import { parseTodoMessage } from "../components/TodoUpdateCard";
import { assistantBodyText } from "./budget-incomplete-message";

const ASSISTANT_SNIPPET_MAX = 600;
const ASSISTANT_SNIPPET_COUNT = 3;

function truncate(text: string, maxLen: number): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
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
  const summaries = findRecentAssistantSummaries(messages);
  if (summaries.length > 0) {
    sections.push(`【上次产出摘要】\n${summaries.map((s, idx) => `${idx + 1}. ${s}`).join("\n\n")}`);
  }
  sections.push("请基于以上信息继续未完成的工作，不要重新开始。");
  return sections.join("\n\n");
}
