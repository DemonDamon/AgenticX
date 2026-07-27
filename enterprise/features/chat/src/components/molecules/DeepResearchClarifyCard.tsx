"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";

type ClarifyEvent = Extract<DeepResearchEvent, { type: "clarify" }>;

export type DeepResearchClarifyCardProps = {
  events: DeepResearchEvent[];
  disabled?: boolean;
  onSubmitted?: () => void;
};

export function DeepResearchClarifyCard({
  events,
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
  const [done, setDone] = React.useState(false);

  if (clarifyEvents.length === 0 || done) return null;
  const runId = clarifyEvents[0]!.runId;

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
      setDone(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mb-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-sm"
      data-testid="deep-research-clarify-card"
    >
      <div className="mb-2 text-sm font-medium text-foreground">开始前先确认几件事</div>
      <div className="space-y-3">
        {clarifyEvents.map((q) => (
          <div key={`${q.runId}-${q.questionId}`}>
            <div className="mb-1.5 text-xs text-muted-foreground">
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
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
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
                className="mt-2 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs"
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
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
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
          下一步
        </Button>
      </div>
    </div>
  );
}
