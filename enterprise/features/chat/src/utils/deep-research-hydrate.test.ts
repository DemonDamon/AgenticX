import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { hydrateMessagesDeepResearch, mergeDeepResearchHydrate } from "./deep-research-hydrate";

function msg(
  partial: Pick<ChatMessage, "id" | "role" | "content"> & Partial<ChatMessage>,
): ChatMessage {
  return {
    session_id: "s1",
    tenant_id: "t1",
    user_id: "u1",
    created_at: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeDeepResearchHydrate", () => {
  it("attaches latest run events onto the last assistant without workbench", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "deepseek v4" }),
      msg({ id: "a1", role: "assistant", content: "摘要与产物链接" }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-1",
      sessionId: "s1",
      status: "running",
      phase: "synthesize",
      topic: "deepseek v4",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [
        { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
        {
          type: "artifact",
          id: "art-1",
          path: "research/run-1/final-report.md",
          title: "终稿",
          kind: "report",
          bytes: 12,
        },
      ],
    });
    expect(next[1]?.deep_research?.runId).toBe("run-1");
    expect(next[1]?.deep_research?.events).toHaveLength(2);
    expect(next[1]?.deep_research?.status).toBe("completed");
  });

  it("does not overwrite an existing workbench", () => {
    const messages = [
      msg({
        id: "a1",
        role: "assistant",
        content: "x",
        deep_research: {
          runId: "run-existing",
          status: "completed",
          events: [{ type: "phase", phase: "done", message: "ok" }],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-other",
      sessionId: "s1",
      status: "completed",
      phase: "done",
      topic: "t",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [{ type: "narrative", text: "should not attach" }],
    });
    expect(next[0]?.deep_research?.runId).toBe("run-existing");
    expect(next[0]?.deep_research?.events).toHaveLength(1);
  });

  it("recreates only the missing assistant shell when the user turn was persisted", () => {
    const messages = [
      msg({ id: "u-old", role: "user", content: "旧问题" }),
      msg({ id: "a-old", role: "assistant", content: "旧回答" }),
      msg({
        id: "u-live",
        role: "user",
        content: "调研企业知识管理",
        created_at: "2026-08-01T00:01:00.000Z",
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-live",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "调研企业知识管理",
      updatedAt: "2026-08-01T00:02:00.000Z",
      events: [
        { type: "run_started", runId: "run-live" },
        { type: "phase", phase: "lanes", message: "正在检索" },
      ],
    });

    expect(next).toHaveLength(4);
    expect(next[1]?.id).toBe("a-old");
    expect(next[1]?.deep_research).toBeUndefined();
    expect(next[2]?.id).toBe("u-live");
    expect(next[3]?.id).toBe("dr-assistant-run-live");
    expect(next[3]?.deep_research?.runId).toBe("run-live");
    expect(next[3]?.deep_research?.status).toBe("running");
  });

  it("recreates a complete turn when refresh happened before either message persisted", () => {
    const next = mergeDeepResearchHydrate([], {
      runId: "run-first",
      sessionId: "s1",
      status: "awaiting_clarify",
      phase: "clarify",
      topic: "调研向量数据库",
      updatedAt: "2026-08-01T00:02:00.000Z",
      events: [
        { type: "run_started", runId: "run-first" },
        { type: "phase", phase: "clarify", message: "需要澄清" },
      ],
    });

    expect(next.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(next[0]?.content).toBe("调研向量数据库");
    expect(next[1]?.deep_research?.runId).toBe("run-first");
    expect(next[1]?.deep_research?.status).toBe("awaiting_clarify");
  });

  it("hydrates a pending assistant shell with the persisted run id", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "调研模型路由" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        deep_research: { runId: "pending", status: "running", events: [] },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-real",
      sessionId: "s1",
      status: "running",
      phase: "plan",
      topic: "调研模型路由",
      updatedAt: "2026-08-01T00:02:00.000Z",
      events: [{ type: "run_started", runId: "run-real" }],
    });

    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe("a1");
    expect(next[1]?.deep_research?.runId).toBe("run-real");
  });

  it("still queries run-store when history already contains a stale workbench", async () => {
    const messages = [
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        deep_research: {
          runId: "run-stale",
          status: "running",
          events: [{ type: "run_started", runId: "run-stale" }],
        },
      }),
    ];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: {
            latest: {
              runId: "run-stale",
              sessionId: "s1",
              status: "completed",
              phase: "done",
              topic: "t",
              updatedAt: "2026-08-01T00:02:00.000Z",
              events: [
                { type: "run_started", runId: "run-stale" },
                { type: "phase", phase: "done", message: "已完成" },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const next = await hydrateMessagesDeepResearch("s1", messages, fetchImpl as typeof fetch);
    expect(calls).toBe(1);
    expect(next[0]?.deep_research?.status).toBe("completed");
    expect(next[0]?.deep_research?.events).toHaveLength(2);
  });
});
