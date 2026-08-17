/**
 * Synchronous plan_chat revision helpers for /resume.
 * Avoids fire-and-forget orphan + client hydrate races that leave the UI silent.
 */

import type { DeepResearchEvent, ResearchPlanSnapshot } from "@agenticx/sdk-ts";
import {
  buildPlanChatPrompt,
  buildPlanRevisionUserQuery,
  isSkipClarifyReply,
  type PlanChatTurn,
} from "./interaction-policy";
import { buildResearchPlan, enforcePlanBreadth, type ResearchPlan } from "./planner";
import {
  latestResearchPlanEvent,
  snapshotToResearchPlan,
  toPlanSnapshot,
} from "./plan-gate-orphan";
import type { RunStore } from "./run-store";
import { sanitizeResearchTopic } from "./delivery-prefs";

export async function waitForResearchPlanBump(input: {
  runStore: RunStore;
  tenantId: string;
  userId: string;
  runId: string;
  baselineVersion: number;
  timeoutMs?: number;
}): Promise<Extract<DeepResearchEvent, { type: "research_plan" }> | null> {
  const timeoutMs = input.timeoutMs ?? 90_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await input.runStore.get(input.tenantId, input.userId, input.runId);
    const latest = latestResearchPlanEvent(run?.events ?? []);
    if (
      latest &&
      (latest.version > input.baselineVersion || latest.action === "approved")
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

function historyFromEvents(events: DeepResearchEvent[]): {
  history: PlanChatTurn[];
  roundsUsed: number;
} {
  const history: PlanChatTurn[] = [];
  let roundsUsed = 0;
  for (const event of events) {
    if (event.type === "clarify_chat" && event.phase === "plan") {
      roundsUsed = Math.max(roundsUsed, event.roundIndex);
    }
    if (event.type === "narrative" && typeof event.text === "string") {
      if (event.text.startsWith("你：")) {
        const content = event.text.slice("你：".length).trim();
        if (content) history.push({ role: "user", content });
      }
    }
    if (event.type === "research_plan" && event.action === "updated") {
      history.push({
        role: "assistant",
        content: `已更新计划 v${event.version}`,
      });
    }
  }
  return { history, roundsUsed };
}

export async function syncRevisePlanChat(input: {
  runStore: RunStore;
  runId: string;
  chatReply: string;
  proposedSnapshot: ResearchPlanSnapshot;
  proposedVersion: number;
  topic: string;
  originalQuery: string;
  priorEvents: DeepResearchEvent[];
  gateway: {
    url: string;
    headers: Record<string, string>;
    model: string;
  };
  fetchImpl?: typeof fetch;
}): Promise<{ plan: ResearchPlanSnapshot; version: number } | { skippedApprove: true; plan: ResearchPlanSnapshot; version: number }> {
  const reply = input.chatReply.trim();
  if (!reply) {
    return {
      plan: input.proposedSnapshot,
      version: input.proposedVersion,
    };
  }

  if (isSkipClarifyReply(reply)) {
    const snapshot = input.proposedSnapshot;
    await input.runStore.appendEvents(
      input.runId,
      [
        {
          type: "research_plan",
          runId: input.runId,
          action: "approved",
          version: input.proposedVersion,
          plan: snapshot,
        },
        { type: "narrative", text: "已按当前计划开始调研。" },
      ],
      { status: "running", phase: "lanes" },
    );
    return { skippedApprove: true, plan: snapshot, version: input.proposedVersion };
  }

  const { history, roundsUsed } = historyFromEvents(input.priorEvents);
  const nextHistory: PlanChatTurn[] = [...history, { role: "user", content: reply }];
  let plan: ResearchPlan = snapshotToResearchPlan(
    input.proposedSnapshot,
    input.topic || input.proposedSnapshot.objective,
  );

  const next = await buildResearchPlan({
    url: input.gateway.url,
    headers: input.gateway.headers,
    body: { model: input.gateway.model },
    userQuery: buildPlanRevisionUserQuery({
      originalQuery: input.originalQuery || input.topic || plan.topic,
      plan: {
        topic: plan.topic,
        complexity: plan.complexity,
        subQuestions: plan.subQuestions,
      },
      planVersion: input.proposedVersion,
      chatHistory: nextHistory,
    }),
    fetchImpl: input.fetchImpl,
  });

  plan = enforcePlanBreadth(
    {
      ...next,
      topic: sanitizeResearchTopic(next.topic || input.originalQuery || plan.topic),
    },
    input.originalQuery || plan.topic,
  );
  const version = input.proposedVersion + 1;
  const snapshot = toPlanSnapshot(plan, version, input.proposedSnapshot.assumptions ?? []);
  const promptText = buildPlanChatPrompt(version);

  const armed = await input.runStore.beginClarification(
    input.runId,
    [
      { type: "narrative", text: `你：${reply}` },
      { type: "narrative", text: "正在根据你的反馈更新计划…" },
      {
        type: "research_plan",
        runId: input.runId,
        action: "updated",
        version,
        plan: snapshot,
      },
      {
        type: "clarify_chat",
        runId: input.runId,
        roundIndex: roundsUsed + 1,
        phase: "plan",
        promptText,
      },
    ],
    null,
    "plan",
  );
  if (!armed) {
    throw new Error("plan gate could not be re-armed");
  }

  return { plan: snapshot, version };
}
