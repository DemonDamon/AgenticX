"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";
import { parseClarifyResumeResponse } from "../../utils/deep-research-clarify-resume";

type ClarifyChatEvent = Extract<DeepResearchEvent, { type: "clarify_chat" }>;

/** clarify_chat 回复在 clarifyAnswers 中的键（与后端 run-wait 对齐）。 */
export const CHAT_CLARIFY_ANSWER_KEY = "__chat__";

export type DeepResearchClarifyChatProps = {
  events: DeepResearchEvent[];
  /** When false, render read-only transcript of the latest round. */
  awaiting?: boolean;
  clarifyAnswers?: Record<string, string>;
  timedOut?: boolean;
  disabled?: boolean;
  onSubmitted?: (answers: Record<string, string>) => void;
};

function latestChatEvent(events: DeepResearchEvent[]): ClarifyChatEvent | null {
  let latest: ClarifyChatEvent | null = null;
  for (const event of events) {
    if (event.type !== "clarify_chat") continue;
    if (!latest || event.roundIndex >= latest.roundIndex) latest = event;
  }
  return latest;
}

/**
 * 对话式澄清：不弹卡片，在消息流里展示模型的自然语言引导；
 * 用户直接在下方输入框回复（或点「直接开始」按默认范围跑）。
 */
export function DeepResearchClarifyChat({
  events,
  awaiting = false,
  clarifyAnswers,
  timedOut = false,
  disabled,
  onSubmitted,
}: DeepResearchClarifyChatProps) {
  const chatEvent = React.useMemo(() => latestChatEvent(events), [events]);
  const [reply, setReply] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!chatEvent) return null;

  const runId = chatEvent.runId;
  const savedReply = clarifyAnswers?.[CHAT_CLARIFY_ANSWER_KEY]?.trim() ?? "";
  const effectivelyTimedOut = timedOut;
  const showInteractive = awaiting && !effectivelyTimedOut && !savedReply;

  const submit = async (skip: boolean) => {
    const text = reply.trim();
    if (!skip && !text) {
      setError("请先输入回复，或点击「直接开始」按默认范围调研。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/deep-research/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          skip ? { runId, skip: true } : { runId, chatReply: text.slice(0, 2_000) },
        ),
      });
      const bodyText = await res.text();
      const parsed = parseClarifyResumeResponse(res.status, bodyText);
      if (parsed.kind === "error") {
        setError(parsed.message);
        return;
      }
      onSubmitted?.(skip ? {} : { [CHAT_CLARIFY_ANSWER_KEY]: text });
      if (parsed.kind === "already_continued") {
        setError(parsed.message);
      }
    } catch {
      setError("网络异常，提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mb-3 rounded-xl border-l-2 border-primary/60 bg-muted/40 px-4 py-3"
      data-testid="deep-research-clarify-chat"
    >
      <div className="text-xs font-medium text-muted-foreground">
        深度研究 · 开题确认{chatEvent.phase === "midrun" ? "（运行中补充）" : ""}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {chatEvent.promptText}
      </p>

      {savedReply ? (
        <div className="mt-2 rounded-lg bg-background/70 px-3 py-2 text-sm text-foreground">
          <span className="text-xs text-muted-foreground">我的回复：</span>
          {savedReply}
        </div>
      ) : effectivelyTimedOut && !showInteractive ? (
        <div className="mt-2 text-xs text-muted-foreground">澄清超时，已按默认范围继续。</div>
      ) : null}

      {showInteractive ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="min-h-[64px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="直接回复即可；也可以说「直接开始」…"
            value={reply}
            disabled={disabled || submitting}
            onChange={(e) => setReply(e.target.value)}
            data-testid="deep-research-clarify-chat-input"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={disabled || submitting}
              onClick={() => void submit(false)}
              data-testid="deep-research-clarify-chat-submit"
            >
              提交回复
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || submitting}
              onClick={() => void submit(true)}
              data-testid="deep-research-clarify-chat-skip"
            >
              直接开始
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
