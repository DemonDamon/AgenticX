import { Sparkles } from "lucide-react";
import type { Message } from "../../store";
import { Shimmer } from "../ds/Shimmer";
import {
  formatToolElapsedSeconds,
  useLiveToolElapsedSeconds,
} from "./tool-elapsed-timer";

type ToolActivityMessage = Pick<
  Message,
  | "id"
  | "toolCallId"
  | "toolName"
  | "toolElapsedSec"
  | "inlineConfirm"
  | "clarificationPrompt"
  | "actionConfirmation"
>;

/** Translate implementation-facing tool names into calm, user-facing work phases. */
export function resolveToolActivityLabel(toolNameRaw: unknown): string {
  const toolName = String(toolNameRaw ?? "").trim().toLowerCase();
  if (!toolName) return "正在处理";
  if (/(search|browse|browser|fetch|lookup|query|knowledge)/.test(toolName)) {
    return "正在查找资料";
  }
  if (/(write|edit|create|save|export|render|generate)/.test(toolName)) {
    return "正在整理内容";
  }
  if (/(bash|exec|terminal|command|run|test|build)/.test(toolName)) {
    return "正在执行任务";
  }
  if (/(read|view|list|inspect|parse|document|image|pdf|file)/.test(toolName)) {
    return "正在查看内容";
  }
  if (/(delegate|spawn|subagent|avatar|group)/.test(toolName)) {
    return "正在协调任务";
  }
  return "正在处理";
}

/** Interactive or user-facing outputs remain visible even when raw tool details are hidden. */
export function shouldPreserveToolDetails(message: ToolActivityMessage): boolean {
  if (message.inlineConfirm || message.clarificationPrompt || message.actionConfirmation) return true;
  const toolName = String(message.toolName ?? "").trim();
  return toolName === "skill_manage" || toolName === "bash_bg_start";
}

export type ToolActivityPresentation = "details" | "activity" | "hidden";

export function resolveToolActivityPresentation(
  showToolCalls: boolean,
  inProgress: boolean,
): ToolActivityPresentation {
  if (showToolCalls) return "details";
  return inProgress ? "activity" : "hidden";
}

export function ToolActivityIndicator({
  message,
  active = true,
  flat = false,
}: {
  message: ToolActivityMessage;
  active?: boolean;
  flat?: boolean;
}) {
  const identity = String(message.toolCallId || message.id || "tool-activity");
  const elapsed = useLiveToolElapsedSeconds(identity, active, message.toolElapsedSec);
  const label = resolveToolActivityLabel(message.toolName);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={
        flat
          ? "flex min-w-0 items-center gap-2 px-3 py-1 text-[13px] text-text-muted"
          : "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-[13px] text-text-muted"
      }
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-[rgba(var(--theme-color-rgb),0.16)]" />
        <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(var(--theme-color-rgb),0.12)] text-[rgb(var(--theme-color-rgb,59,130,246))]">
          <Sparkles className="h-2.5 w-2.5" strokeWidth={2.2} />
        </span>
      </span>
      <Shimmer
        variant="status"
        text={`${label} · ${formatToolElapsedSeconds(elapsed)}`}
        className="min-w-0 truncate font-medium tabular-nums"
      />
    </div>
  );
}
