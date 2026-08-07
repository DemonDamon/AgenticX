"use client";

import * as React from "react";
import type { DeepResearchEvent, ResearchPlanSnapshot } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";
import { parseClarifyResumeResponse } from "../../utils/deep-research-clarify-resume";
import { useChatStore } from "../../store";

/** Portal listens and starts reconnect so orphan-continue events reach the workbench. */
export const PLAN_GATE_RESUMED_EVENT = "agx-deep-research-plan-resumed";

type ResearchPlanEvent = Extract<DeepResearchEvent, { type: "research_plan" }>;

export const PLAN_GATE_ACTION_KEY = "__plan_action__";

export type DeepResearchPreflightCardProps = {
  events: DeepResearchEvent[];
  /** True while the backend waits on the plan gate. */
  awaiting?: boolean;
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

/** 用户是否还在计划 gate 上（最新事件是 proposed，尚无 approved/updated）。 */
export function isPlanGatePending(events: DeepResearchEvent[]): boolean {
  const latest = latestPlanEvent(events);
  return latest?.action === "proposed";
}

const ACTION_LABEL: Record<ResearchPlanEvent["action"], string> = {
  proposed: "草案",
  updated: "已更新",
  approved: "已确认",
};

function PlanBody({ plan }: { plan: ResearchPlanSnapshot }) {
  return (
    <div className="mt-2 space-y-2 text-sm leading-6">
      <div>
        <span className="text-xs font-medium text-muted-foreground">我的理解：</span>
        <span className="text-foreground">{plan.objective}</span>
      </div>
      {plan.subQuestions.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground">研究计划草案：</div>
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
 * 开题卡：计划草案 + 「确认并开始 / 修改计划 / 直接开始」。
 * 只在 planVisibility = editable（用户选「先看计划」）时出现；hidden 不渲染。
 */
export function DeepResearchPreflightCard({
  events,
  awaiting = false,
  disabled,
  onSubmitted,
}: DeepResearchPreflightCardProps) {
  const planEvent = React.useMemo(() => latestPlanEvent(events), [events]);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** 同步锁：避免连点在 setState 生效前打出第二次 resume（第二次必 alreadyContinued）。 */
  const submitLockRef = React.useRef(false);
  const resumedOnceRef = React.useRef(false);

  if (!planEvent) return null;
  const runId = planEvent.runId;
  const plan = planEvent.plan;
  const showInteractive = awaiting && planEvent.action === "proposed";

  const submit = async (action: "approve" | "edit" | "skip") => {
    if (submitLockRef.current || resumedOnceRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      let planPatch: string | undefined;
      let planSnapshot: ResearchPlanSnapshot = plan;
      if (action === "edit") {
        const subQuestions = draft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 8)
          .map((line) => line.slice(0, 200));
        if (subQuestions.length === 0) {
          setError("请至少保留一条子问题，或点「确认并开始」按草案执行。");
          return;
        }
        planPatch = JSON.stringify({ subQuestions });
        // 一并带上编辑后快照，供进程重启后 run-store 被清空时孤儿续跑。
        planSnapshot = {
          ...plan,
          subQuestions: subQuestions.map((title, i) => ({
            id: plan.subQuestions[i]?.id ?? `sq${i + 1}`,
            title,
            ...(plan.subQuestions[i]?.purpose
              ? { purpose: plan.subQuestions[i]!.purpose }
              : {}),
          })),
        };
      }
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
      const orphanContext = {
        planSnapshot,
        ...(sessionId ? { sessionId } : {}),
        ...(topic ? { topic } : {}),
        ...(activeModel ? { model: activeModel } : {}),
      };
      const res = await fetch("/api/chat/deep-research/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "skip"
            ? { runId, skip: true, planAction: "skip", ...orphanContext }
            : {
                runId,
                planAction: action,
                ...(planPatch ? { planPatch } : {}),
                ...orphanContext,
              },
        ),
      });
      const bodyText = await res.text();
      const parsed = parseClarifyResumeResponse(res.status, bodyText, "plan");
      if (parsed.kind === "error") {
        setError(parsed.message);
        return;
      }
      const notifyResumed = () => {
        onSubmitted?.();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(PLAN_GATE_RESUMED_EVENT, { detail: { runId } }),
          );
        }
      };
      if (parsed.kind === "resumed") {
        resumedOnceRef.current = true;
        notifyResumed();
        if (action === "edit") setEditing(false);
        return;
      }
      // already_continued：若本卡已成功 resume 过，视为连点噪音，不吓人。
      if (resumedOnceRef.current) {
        notifyResumed();
        setEditing(false);
        return;
      }
      onSubmitted?.();
      setError(parsed.message);
      setEditing(false);
    } catch {
      setError("网络异常，提交失败，请重试。");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mb-3 rounded-xl border border-border bg-muted/40 px-4 py-3"
      data-testid="deep-research-preflight-card"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>深度研究 · 研究计划</span>
        <span className="rounded-full bg-background px-2 py-0.5">
          v{planEvent.version} · {ACTION_LABEL[planEvent.action]}
        </span>
      </div>

      {editing && showInteractive ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            每行一条子问题（最多 8 条），提交后按计划 v{planEvent.version + 1} 执行：
          </div>
          <textarea
            className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={draft}
            disabled={disabled || submitting}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="deep-research-plan-edit-input"
          />
        </div>
      ) : (
        <PlanBody plan={plan} />
      )}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {showInteractive ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            确认或修改前不会自动开始检索，请点下方按钮继续。
          </p>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={disabled || submitting}
                onClick={() => void submit("edit")}
                data-testid="deep-research-plan-edit-submit"
              >
                提交修改并开始
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || submitting}
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={disabled || submitting}
                onClick={() => void submit("approve")}
                data-testid="deep-research-plan-approve"
              >
                确认并开始
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || submitting}
                onClick={() => {
                  setDraft(plan.subQuestions.map((sq) => sq.title).join("\n"));
                  setEditing(true);
                }}
                data-testid="deep-research-plan-edit-open"
              >
                修改计划
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || submitting}
                onClick={() => void submit("skip")}
                data-testid="deep-research-plan-skip"
              >
                直接开始
              </Button>
            </>
          )}
        </div>
        </div>
      ) : null}
    </div>
  );
}
