import { describe, expect, it } from "vitest";
import { buildRuntimeDashboard, type RuntimeAgent, type RuntimeSpan, type RuntimeUser } from "../runtime-dashboard";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const CURRENT = "2026-10-15T09:00:00.000Z";
const PREVIOUS = "2026-10-14T09:00:00.000Z";

const agents: RuntimeAgent[] = [
  { id: "agent-1", slug: "coder", displayName: "桌面编码", localAvatarId: "local-1", status: "active" },
  { id: "agent-2", slug: "old", displayName: "已停用", localAvatarId: null, status: "disabled" },
];

const users: RuntimeUser[] = [{ id: "user-1", displayName: "管理员" }];

function span(partial: Partial<RuntimeSpan> & Pick<RuntimeSpan, "trace_id" | "step_kind">): RuntimeSpan {
  return {
    status: "ok",
    model: null,
    provider: null,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    created_at: CURRENT,
    metadata: null,
    ...partial,
  };
}

describe("buildRuntimeDashboard", () => {
  it("counts requests, model calls and tokens from the last 24 hours against the previous day", () => {
    const spans: RuntimeSpan[] = [
      span({
        trace_id: "near:s1:r1",
        step_kind: "run",
        total_tokens: 999999,
        metadata: { agent_id: "local-1", user_id: "user-1", source: "near" },
      }),
      span({
        trace_id: "near:s1:r1",
        step_kind: "model",
        model: "glm-5.3-flash",
        provider: "zhipu",
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
        metadata: { user_id: "user-1" },
      }),
      span({
        trace_id: "web-trace",
        step_kind: "model",
        status: "error",
        model: "glm-5.3-flash",
        provider: "zhipu",
        input_tokens: 20000,
        output_tokens: 5000,
        total_tokens: 25000,
        metadata: { user_id: "user-2" },
      }),
      span({
        trace_id: "near:s0:r0",
        step_kind: "run",
        created_at: PREVIOUS,
        metadata: { agent_id: "agent-1", user_id: "user-1" },
      }),
      span({
        trace_id: "near:s0:r0",
        step_kind: "model",
        created_at: PREVIOUS,
        model: "glm-5.3-flash",
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      }),
    ];

    const dashboard = buildRuntimeDashboard(spans, agents, users, {}, NOW);

    expect(dashboard.cards.requests).toEqual({ value: 2, previous: 1, delta_pct: 100 });
    expect(dashboard.cards.model_calls).toEqual({ value: 2, previous: 1, delta_pct: 100 });
    expect(dashboard.cards.input_tokens.value).toBe(21000);
    expect(dashboard.cards.output_tokens.value).toBe(5500);
    expect(dashboard.cards.total_tokens.value).toBe(26500);
    expect(dashboard.cards.total_tokens.previous).toBe(15);
    expect(dashboard.cards.agents.value).toBe(1);
    expect(dashboard.registered_agents).toBe(1);
    expect(dashboard.calls_by_agent_model.map((row) => row.name)).toContain("桌面编码 · glm-5.3-flash");
    expect(dashboard.token_buckets.find((row) => row.bucket === "1K-5K")?.traces).toBe(1);
    expect(dashboard.token_buckets.find((row) => row.bucket === ">20K")?.traces).toBe(1);
    expect(dashboard.tokens_by_model[0]).toEqual({ name: "glm-5.3-flash", tokens: 26500 });
    expect(dashboard.model_error_trend.some((row) => row.errors === 1)).toBe(true);
    expect(dashboard.request_trend.some((row) => row.requests === 2 && row.errors === 1)).toBe(true);
    expect(dashboard.filters.users).toEqual([
      { id: "user-1", label: "管理员" },
      { id: "user-2", label: "user-2" },
    ]);
  });

  it("does not invent a percentage when the previous window is empty", () => {
    const dashboard = buildRuntimeDashboard(
      [span({ trace_id: "near:only:1", step_kind: "model", model: "m", total_tokens: 8, input_tokens: 5, output_tokens: 3 })],
      [],
      [],
      {},
      NOW,
    );
    expect(dashboard.cards.requests.delta_pct).toBeNull();
    expect(dashboard.cards.total_tokens.delta_pct).toBeNull();
  });

  it("filters by user without dropping the option list", () => {
    const spans = [
      span({ trace_id: "near:a:1", step_kind: "model", model: "m", total_tokens: 10, metadata: { user_id: "user-1", agent_id: "local-1" } }),
      span({ trace_id: "near:b:1", step_kind: "model", model: "other", total_tokens: 40, metadata: { user_id: "user-2", agent_id: "agent-1" } }),
    ];
    const dashboard = buildRuntimeDashboard(spans, agents, users, { userId: "user-1" }, NOW);
    expect(dashboard.cards.requests.value).toBe(1);
    expect(dashboard.cards.total_tokens.value).toBe(10);
    expect(dashboard.filters.users).toHaveLength(2);
    expect(dashboard.filters.sources).toEqual(["desktop"]);
  });
});
