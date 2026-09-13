"use client";

import * as React from "react";
import type { DeepResearchEvent, ResearchPlanSnapshot } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";
import { parseClarifyResumeResponse } from "../../utils/deep-research-clarify-resume";
import {
  isPlanChatGatePending,
  isPlanChatUpdating,
} from "../../utils/deep-research-plan-chat-composer";
import { useChatStore } from "../../store";
import { PLAN_GATE_RESUMED_EVENT } from "./DeepResearchPreflightCard";
import { useChatCopy } from "../../i18n/ChatLocaleProvider";

type ResearchPlanEvent = Extract<DeepResearchEvent, { type: "research_plan" }>;

export type DeepResearchPlanChatCardProps = {
  events: DeepResearchEvent[];
  /** True while the backend waits on the plan_chat gate. */
  awaiting?: boolean;
  /**
   * 是否为当前最新方案卡。历史卡（已被后续改计划替代）只展示内容，
   * 不显示「开始调研」——避免同一 run 上多张卡都能开跑。
   */
  interactive?: boolean;
  disabled?: boolean;
  onSubmitted?: () => void;
};

function latestPlanEvent(events: DeepResearchEvent[]): ResearchPlanEvent | null {
  let latest: ResearchPlanEvent | null = null;
  for (const event of events) {
    if (event.type === "research_plan") latest = event;
  }
  return latest;
}

/** @deprecated use utils/deep-research-plan-chat-composer — re-exported for callers. */
export { isPlanChatGatePending };

function PlanBody({ plan }: { plan: ResearchPlanSnapshot }) {
  const copy = useChatCopy();
  return (
    <div className="mt-2 space-y-2 text-sm leading-6">
      <div>
        <span className="text-xs font-medium text-muted-foreground">{copy.preflight.myUnderstanding}</span>
        <span className="text-foreground">{plan.objective}</span>
      </div>
      {plan.subQuestions.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground">{copy.preflight.planDraft}</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-foreground">
            {plan.subQuestions.map((sq) => (
              <li key={sq.id}>{sq.title}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {plan.assumptions.length > 0 ? (
        <div className="rounded-lg bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          {plan.assumptions.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 计划对齐卡：展示某一版计划；仅最新卡提供「开始调研」。
 * 多轮修改走主聊天输入框，每次改计划在对话流里追加新助手气泡+新卡。
 */
export function DeepResearchPlanChatCard({
  events,
  awaiting = false,
  interactive = true,
  disabled,
  onSubmitted,
}: DeepResearchPlanChatCardProps) {
  const copy = useChatCopy();
  const planEvent = React.useMemo(() => latestPlanEvent(events), [events]);
  const updating = React.useMemo(
    () => awaiting && interactive && isPlanChatUpdating(events),
    [awaiting, events, interactive],
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitLockRef = React.useRef(false);
  const resumedStartRef = React.useRef(false);

  if (!planEvent) return null;
  const runId = planEvent.runId;
  const plan = planEvent.plan;
  // 仅最新未批准卡可点「开始调研」；历史卡只读。
  const showInteractive =
    interactive && planEvent.action !== "approved" && !resumedStartRef.current;

  const orphanContext = () => {
    const store = useChatStore.getState();
    const activeModel = store.activeModel?.trim() || undefined;
    const sessionId = store.activeSessionId?.trim() || undefined;
    const topic =
      plan.objective?.trim() ||
      store.messages
        .filter((m) => m.session_id === sessionId && m.role === "user")
        .at(-1)
        ?.content?.trim() ||
      undefined;
    return {
      planSnapshot: plan,
      ...(sessionId ? { sessionId } : {}),
      ...(topic ? { topic } : {}),
      ...(activeModel ? { model: activeModel } : {}),
    };
  };

  const notifyResumed = () => {
    onSubmitted?.();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(PLAN_GATE_RESUMED_EVENT, { detail: { runId } }),
      );
    }
  };

  const submitStart = async () => {
    if (submitLockRef.current || resumedStartRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/deep-research/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          planAction: "approve",
          ...orphanContext(),
        }),
      });
      const bodyText = await res.text();
      const parsed = parseClarifyResumeResponse(res.status, bodyText, "plan");
      if (parsed.kind === "error") {
        setError(parsed.message);
        return;
      }
      if (parsed.kind === "resumed" || resumedStartRef.current) {
        resumedStartRef.current = true;
        notifyResumed();
        return;
      }
      onSubmitted?.();
      setError(parsed.message);
    } catch {
      setError(copy.planChat.networkFailed);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const actionLabel =
    planEvent.action === "updated"
      ? copy.planChat.actionUpdated
      : planEvent.action === "approved"
        ? copy.planChat.actionApproved
        : copy.planChat.actionProposed;

  return (
    <div
      className="mb-3 rounded-xl border border-border bg-muted/40 px-4 py-3"
      data-testid="deep-research-plan-chat-card"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>{copy.planChat.title}</span>
        <span
          className="rounded-full bg-background px-2 py-0.5"
          data-testid="deep-research-plan-chat-version"
        >
          v{planEvent.version} · {actionLabel}
        </span>
        {updating ? (
          <span
            className="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
            data-testid="deep-research-plan-chat-updating"
          >
            {copy.planChat.updating}
          </span>
        ) : null}
      </div>

      <PlanBody plan={plan} />

      {showInteractive ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {copy.planChat.editHint}
        </p>
      ) : !interactive && planEvent.action !== "approved" ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {copy.planChat.historic}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {showInteractive ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={disabled || submitting || updating}
            onClick={() => void submitStart()}
            data-testid="deep-research-plan-chat-start"
          >
            {copy.planChat.startResearch}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
