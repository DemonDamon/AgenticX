"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";

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
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(!awaiting);

  React.useEffect(() => {
    setCollapsed(!awaiting);
  }, [awaiting]);

  if (clarifyEvents.length === 0) return null;
  const runId = clarifyEvents[0]!.runId;
  const savedAnswers = clarifyAnswers ?? {};
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
          const selected = answers[q.questionId]?.trim();
          const customText = custom[q.questionId]?.trim();
          const value = customText || selected;
          if (value) payloadAnswers[q.questionId] = value;
        }
      }
      const response = await fetch("/api/chat/deep-research/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, answers: payloadAnswers, skip }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `HTTP ${response.status}`);
      }
      onSubmitted?.(payloadAnswers);
      setCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = showInteractive
    ? "等待确认"
    : timedOut && !hasSavedAnswers
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
                我先快速确认一下调研方向，然后开始系统检索。
              </p>
              <div className="space-y-3">
                {clarifyEvents.map((q) => (
                  <div key={`${q.runId}-${q.questionId}`}>
                    <div className="mb-1.5 text-sm font-medium leading-5 text-foreground">
                      {q.step}/{q.total} · {q.question}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((opt) => {
                        const selected = answers[q.questionId] === opt.label;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={disabled || submitting}
                            onClick={() => {
                              setAnswers((prev) => ({ ...prev, [q.questionId]: opt.label }));
                              setCustom((prev) => ({ ...prev, [q.questionId]: "" }));
                            }}
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
                        placeholder="其他（可选）"
                        value={custom[q.questionId] ?? ""}
                        disabled={disabled || submitting}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustom((prev) => ({ ...prev, [q.questionId]: value }));
                          if (value.trim()) {
                            setAnswers((prev) => {
                              const next = { ...prev };
                              delete next[q.questionId];
                              return next;
                            });
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ))}
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
                    {row.answer || (timedOut ? "（未回答，已按默认假设继续）" : "—")}
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
