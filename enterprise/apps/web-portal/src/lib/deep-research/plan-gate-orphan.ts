/**
 * Detect / rebuild plan-gate state when the in-process waiter died
 * (dev server restart, HMR isolate swap) but the run is still awaiting_clarify
 * with a proposed research_plan.
 */

import type { DeepResearchEvent, ResearchPlanSnapshot } from "@agenticx/sdk-ts";
import type { ResearchPlan } from "./planner";
import type { RunRecord } from "./run-store";
import { hasLiveClarifyWaiter } from "./run-wait";

export type ResearchPlanEvent = Extract<DeepResearchEvent, { type: "research_plan" }>;

/** Latest research_plan event, or null. */
export function latestResearchPlanEvent(
  events: DeepResearchEvent[],
): ResearchPlanEvent | null {
  let latest: ResearchPlanEvent | null = null;
  for (const event of events) {
    if (event.type === "research_plan") latest = event;
  }
  return latest;
}

/**
 * Which gate the run is stuck on for orphan recovery.
 * - plan: latest plan is still proposed/updated (plan_chat multi-round) and lanes not started
 * - clarify: still in clarify and no proposed plan yet
 * - null: not recoverable via resume orphan path
 */
export function orphanGateKind(
  events: DeepResearchEvent[],
): "plan" | "clarify" | null {
  const latestPlan = latestResearchPlanEvent(events);
  if (latestPlan?.action === "approved") {
    return null;
  }
  // proposed / updated (plan_chat 多轮改计划后仍在 gate) 都算 plan gate，
  // 前提是后面还没开车道。
  if (latestPlan?.action === "proposed" || latestPlan?.action === "updated") {
    const planIndex = events.lastIndexOf(latestPlan);
    for (let i = planIndex + 1; i < events.length; i += 1) {
      const event = events[i]!;
      if (event.type === "lane_started") return null;
      if (event.type === "phase" && event.phase === "lanes") return null;
      if (
        event.type === "narrative" &&
        /超时|按草案|已按修改后的计划开始|已跳过计划确认|已按当前计划开始|已达对话轮次上限|继续执行研究/.test(
          event.text ?? "",
        )
      ) {
        return null;
      }
    }
    return "plan";
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "clarify" || event.type === "clarify_chat") {
      // plan 阶段的 clarify_chat 属于计划对齐 gate，不是独立 clarify orphan。
      if (event.type === "clarify_chat" && event.phase === "plan") return "plan";
      return "clarify";
    }
    if (event.type === "lane_started") return null;
  }
  return null;
}

export function snapshotToResearchPlan(
  snapshot: ResearchPlanSnapshot,
  topicFallback: string,
): ResearchPlan {
  const subQuestions = snapshot.subQuestions
    .map((sq) => sq.title.trim())
    .filter(Boolean)
    .slice(0, 8);
  const n = subQuestions.length;
  return {
    topic: (snapshot.objective || topicFallback).trim() || topicFallback || "研究主题",
    complexity: n >= 6 ? "complex" : n >= 4 ? "moderate" : "simple",
    subQuestions: subQuestions.length > 0 ? subQuestions : [topicFallback || "研究该主题"],
  };
}

export function toPlanSnapshot(
  plan: ResearchPlan,
  version: number,
  assumptions: string[] = [],
): ResearchPlanSnapshot {
  return {
    version,
    objective: plan.topic,
    scope: [],
    subQuestions: plan.subQuestions.map((q, i) => ({ id: `sq${i + 1}`, title: q })),
    sourceStrategy: [],
    deliverables: [],
    assumptions,
  };
}

/**
 * True when the run is still on a plan gate (proposed/updated) and THIS process
 * has no live Promise waiter — typical after portal restart / stale reap.
 * Status may be awaiting_clarify, running (desynced), or failed/cancelled (reaped).
 */
export function isOrphanedPlanGate(run: RunRecord): boolean {
  if (run.status === "completed") return false;
  if (orphanGateKind(run.events) !== "plan") return false;
  if (hasLiveClarifyWaiter(run.runId)) return false;
  const action = latestResearchPlanEvent(run.events)?.action;
  return action === "proposed" || action === "updated";
}

/** Minimal validation for client-attested plan snapshots (resume after store wipe). */
export function parseClientPlanSnapshot(raw: unknown): ResearchPlanSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === "number" && Number.isFinite(o.version) ? o.version : NaN;
  if (!(version >= 1)) return null;
  const objective = typeof o.objective === "string" ? o.objective.trim() : "";
  if (!objective) return null;
  if (!Array.isArray(o.subQuestions) || o.subQuestions.length === 0) return null;
  const subQuestions: ResearchPlanSnapshot["subQuestions"] = [];
  for (const item of o.subQuestions.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const sq = item as Record<string, unknown>;
    const id = typeof sq.id === "string" && sq.id.trim() ? sq.id.trim() : `sq${subQuestions.length + 1}`;
    const title = typeof sq.title === "string" ? sq.title.trim().slice(0, 200) : "";
    if (!title) continue;
    subQuestions.push({
      id,
      title,
      ...(typeof sq.purpose === "string" && sq.purpose.trim()
        ? { purpose: sq.purpose.trim().slice(0, 200) }
        : {}),
    });
  }
  if (subQuestions.length === 0) return null;
  const asStringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim().slice(0, 200))
          .slice(0, 12)
      : [];
  return {
    version: Math.floor(version),
    objective: objective.slice(0, 500),
    scope: asStringList(o.scope),
    subQuestions,
    sourceStrategy: asStringList(o.sourceStrategy),
    deliverables: asStringList(o.deliverables),
    assumptions: asStringList(o.assumptions),
  };
}
