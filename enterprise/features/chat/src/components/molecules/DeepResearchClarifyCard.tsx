"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";
import { parseClarifyResumeResponse } from "../../utils/deep-research-clarify-resume";

type ClarifyEvent = Extract<DeepResearchEvent, { type: "clarify" }>;

function IconMessageCircle({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Join multi-selected option labels (+ optional custom) for resume payload. */
export function formatClarifyAnswer(
  selectedLabels: readonly string[],
  customText?: string,
): string {
  const parts = selectedLabels.map((s) => s.trim()).filter(Boolean);
  const custom = customText?.trim();
  if (custom) parts.push(custom);
  return parts.join("、");
}

/** Multi-select toggle, or single-select replace when multiSelect is false. */
export function nextClarifySelection(
  current: readonly string[],
  label: string,
  multiSelect: boolean,
): string[] {
  if (!multiSelect) {
    return current.includes(label) ? [] : [label];
  }
  if (current.includes(label)) {
    return current.filter((item) => item !== label);
  }
  return [...current, label];
}

export type DeepResearchClarifyCardProps = {
  events: DeepResearchEvent[];
  /** When false, render read-only「已收集信息」panel after answers / timeout. */
  awaiting?: boolean;
  clarifyAnswers?: Record<string, string>;
  timedOut?: boolean;
  disabled?: boolean;
  onSubmitted?: (answers: Record<string, string>) => void;
};

export function DeepResearchClarifyCard({
  events,
  awaiting = false,
  clarifyAnswers,
  timedOut = false,
  disabled,
  onSubmitted,
}: DeepResearchClarifyCardProps) {
  const clarifyEvents = React.useMemo(
    () => events.filter((e): e is ClarifyEvent => e.type === "clarify"),
    [events],
  );
  /** Per-question selected option labels (multi-select). */
  const [answers, setAnswers] = React.useState<Record<string, string[]>>({});
  const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [localTimedOut, setLocalTimedOut] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(!awaiting);

  React.useEffect(() => {
    setCollapsed(!awaiting);
  }, [awaiting]);

  const toggleOption = React.useCallback(
    (questionId: string, label: string, multiSelect: boolean) => {
      setAnswers((prev) => {
        const current = prev[questionId] ?? [];
        const next = nextClarifySelection(current, label, multiSelect);
        if (next.length === 0) {
          const cleared = { ...prev };
          delete cleared[questionId];
          return cleared;
        }
        return { ...prev, [questionId]: next };
      });
    },
    [],
  );

  if (clarifyEvents.length === 0) return null;
  const runId = clarifyEvents[0]!.runId;
  const savedAnswers = clarifyAnswers ?? {};
  const effectivelyTimedOut = timedOut || localTimedOut;
  const showInteractive = awaiting;

  const resolvedLines = clarifyEvents.map((q) => {
    const answer = savedAnswers[q.questionId]?.trim();
    return { question: q.question, answer };
  });
  const hasSavedAnswers = resolvedLines.some((row) => Boolean(row.answer));

  const submit = async (skip: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const payloadAnswers: Record<string, string> = {};
      if (!skip) {
        for (const q of clarifyEvents) {
          const value = formatClarifyAnswer(
            answers[q.questionId] ?? [],
            custom[q.questionId],
          );
          if (value) payloadAnswers[q.questionId] = value;
        }
      }
      const response = await fetch("/api/chat/deep-research/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, answers: payloadAnswers, skip }),
      });
      const text = await response.text().catch(() => "");
      const parsed = parseClarifyResumeResponse(response.status, text);
      if (parsed.kind === "error") {
        setError(parsed.message);
        return;
      }
      if (parsed.kind === "already_continued") {
        // Server already timed out / continued — do not persist late answers as
        // if they were applied; flip the card out of awaiting instead.
        setLocalTimedOut(true);
        onSubmitted?.({});
      } else {
        onSubmitted?.(payloadAnswers);
      }
      setCollapsed(true);
    } catch {
      setError("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = showInteractive
    ? "等待确认"
    : effectivelyTimedOut && !hasSavedAnswers
      ? "超时后按默认假设继续"
      : "已收集信息";

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      data-testid="deep-research-clarify-card"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <IconMessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">询问工具</span>
        <span className="text-sm text-muted-foreground">| {statusLabel}</span>
        <IconChevronDown
          className={[
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            collapsed ? "-rotate-90" : "",
          ].join(" ")}
        />
      </button>

      {!collapsed ? (
        <div className="border-t border-border/50 px-3 py-3">
          {showInteractive ? (
            <>
              <p className="mb-3 text-sm leading-5 text-muted-foreground">
                我先快速确认一下调研方向，然后开始系统检索。每题可多选；请在 5
                分钟内确认；超时将按默认假设继续。
              </p>
              <div className="space-y-3">
                {clarifyEvents.map((q) => {
                  const multiSelect = q.multiSelect !== false;
                  return (
                  <div key={`${q.runId}-${q.questionId}`}>
                    <div className="mb-1.5 flex items-baseline gap-1.5 text-sm font-medium leading-5 text-foreground">
                      <span>
                        {q.step}/{q.total} · {q.question}
                      </span>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {multiSelect ? "可多选" : "请选一个"}
                      </span>
                    </div>
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label={q.question}
                    >
                      {q.options.map((opt) => {
                        const selected = (answers[q.questionId] ?? []).includes(opt.label);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role={multiSelect ? "checkbox" : "radio"}
                            aria-checked={selected}
                            disabled={disabled || submitting}
                            onClick={() =>
                              toggleOption(q.questionId, opt.label, multiSelect)
                            }
                            className={[
                              "rounded-full border px-2.5 py-1 text-sm leading-5 transition-colors",
                              selected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/70 bg-muted/40 text-foreground/80 hover:bg-muted",
                            ].join(" ")}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {q.allowCustom ? (
                      <input
                        className="mt-2 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
                        placeholder="其他（可选，可与上方选项组合）"
                        value={custom[q.questionId] ?? ""}
                        disabled={disabled || submitting}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustom((prev) => ({ ...prev, [q.questionId]: value }));
                        }}
                      />
                    ) : null}
                  </div>
                  );
                })}
              </div>
              {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || submitting}
                  onClick={() => void submit(true)}
                >
                  跳过
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || submitting}
                  onClick={() => void submit(false)}
                >
                  确认并继续
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {resolvedLines.map((row, index) => (
                <div key={`resolved-${index}`}>
                  <div className="text-sm leading-5 text-foreground">{row.question}</div>
                  <div className="mt-0.5 pl-2 text-sm leading-5 text-muted-foreground">
                    {row.answer ||
                      (effectivelyTimedOut ? "（未回答，已按默认假设继续）" : "—")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
