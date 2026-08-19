import { Sparkles } from "lucide-react";
import type { Message } from "../../store";
import { Shimmer } from "../ds/Shimmer";
import {
  formatToolElapsedSeconds,
  useLiveToolElapsedSeconds,
} from "./tool-elapsed-timer";
import { parseBashBgStart } from "./bash-bg-preview";

type ToolActivityMessage = Pick<
  Message,
  | "id"
  | "toolCallId"
  | "toolName"
  | "toolStatus"
  | "toolElapsedSec"
  | "content"
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
  if (toolName === "skill_manage") return true;
  if (toolName !== "bash_bg_start") return false;
  return (parseBashBgStart(String(message.content ?? ""))?.authUrls.length ?? 0) > 0;
}

export type ToolActivityPresentation = "details" | "summary";

export function resolveToolActivityPresentation(
  showToolCalls: boolean,
  inProgress: boolean,
): ToolActivityPresentation {
  if (showToolCalls) return "details";
  void inProgress;
  return "summary";
}

export type ToolActivitySummary = {
  active: boolean;
  tone: "normal" | "error" | "cancelled";
  label: string;
};

/** Aggregate one tool group into a stable, non-technical activity headline. */
export function resolveToolActivitySummary(messages: ToolActivityMessage[]): ToolActivitySummary {
  const visible = messages.filter(Boolean);
  const activeMessage = [...visible]
    .reverse()
    .find((message) => message.toolStatus === "running" || message.toolStatus === "pending");
  const errorCount = visible.filter((message) => message.toolStatus === "error").length;
  if (activeMessage) {
    return {
      active: true,
      tone: errorCount > 0 ? "error" : "normal",
      label: errorCount > 0
        ? `正在继续处理（${errorCount} 个步骤失败）`
        : resolveToolActivityLabel(activeMessage.toolName),
    };
  }

  if (errorCount > 0) {
    return {
      active: false,
      tone: "error",
      label: errorCount === 1 ? "1 个步骤执行失败" : `${errorCount} 个步骤执行失败`,
    };
  }

  const cancelledCount = visible.filter((message) => message.toolStatus === "cancelled").length;
  if (cancelledCount > 0) {
    return {
      active: false,
      tone: "cancelled",
      label: visible.length === 1 ? "执行已停止" : `${cancelledCount} 个步骤已停止`,
    };
  }

  const count = Math.max(1, visible.length);
  return {
    active: false,
    tone: "normal",
    label: `已完成 ${count} 个步骤`,
  };
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
  const summary = resolveToolActivitySummary([message]);
  const isActive = active && summary.active;
  const label = isActive ? resolveToolActivityLabel(message.toolName) : summary.label;

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
        <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(var(--theme-color-rgb),0.12)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]">
          <Sparkles className="h-2.5 w-2.5" strokeWidth={2.2} />
        </span>
      </span>
      {isActive ? (
        <Shimmer
          variant="status"
          text={`${label} · ${formatToolElapsedSeconds(elapsed)}`}
          className="min-w-0 truncate font-medium tabular-nums"
        />
      ) : (
        <span className={`min-w-0 truncate font-medium ${summary.tone === "error" ? "text-rose-400" : ""}`}>
          {label}
        </span>
      )}
    </div>
  );
}
