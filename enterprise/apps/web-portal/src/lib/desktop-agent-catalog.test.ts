import { describe, expect, it } from "vitest";
import type { EnterpriseAgent, MaEnvironment } from "@agenticx/iam-core";
import { buildManifestSummary, toDesktopAgentCard } from "./desktop-agent-catalog";

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ENV = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";

function agent(patch: Partial<EnterpriseAgent> = {}): EnterpriseAgent {
  return {
    id: AGENT,
    tenantId: "t1",
    slug: "report-bot",
    displayName: "报告助手",
    description: null,
    systemPrompt: "你是报告助手",
    model: "openai/gpt-4o",
    runtime: "cloud",
    capabilityIds: [],
    assignmentKeys: [],
    workerKeys: [],
    status: "active",
    lifecycle: "published",
    origin: "enterprise",
    ownerUserId: null,
    localAvatarId: null,
    metadata: {},
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
    ...patch,
  };
}

function environment(patch: Partial<MaEnvironment> = {}): MaEnvironment {
  return {
    id: ENV,
    tenantId: "t1",
    name: "研发桌面",
    description: null,
    type: "desktop_worker",
    config: { type: "desktop_worker", worker_keys: [] },
    status: "active",
    createdBy: null,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
    ...patch,
  };
}

const fullManifest = {
  schema: "agx.agent/v1",
  model: "openai/gpt-4o",
  system: "你是报告助手",
  tools: [
    {
      type: "agx_builtin",
      default_policy: "always_allow",
      configs: [
        { name: "bash_exec", policy: "always_ask", enabled: true },
        { name: "file_read", policy: null, enabled: true },
      ],
    },
    {
      type: "mcp",
      server: "github",
      default_policy: "always_ask",
      configs: [{ name: "get_issue", policy: "always_allow", enabled: true }],
    },
    { type: "custom", name: "lookup_order", description: "查订单", input_schema: { type: "object" } },
  ],
  mcp_servers: [{ name: "github", url: "https://mcp.example.com/", transport: "http" }],
  skills: [{ source: "tenant", id: AGENT, version: "1.2.0" }],
  runtime: { max_tool_rounds: 40, max_session_tokens: null },
  metadata: { welcome_message: "欢迎", suggested_questions: ["本周报告？"] },
};

describe("buildManifestSummary", () => {
  it("summarizes a full manifest and drops mcp urls", () => {
    const summary = buildManifestSummary(fullManifest);
    expect(summary).toEqual({
      model: "openai/gpt-4o",
      system: "你是报告助手",
      builtin: {
        defaultPolicy: "always_allow",
        overrides: [
          { name: "bash_exec", policy: "always_ask", enabled: true },
          { name: "file_read", policy: null, enabled: true },
        ],
      },
      mcp: [{
        server: "github",
        transport: "http",
        defaultPolicy: "always_ask",
        overrides: [{ name: "get_issue", policy: "always_allow", enabled: true }],
      }],
      custom: [{ name: "lookup_order", description: "查订单" }],
      skills: [{ source: "tenant", id: AGENT, version: "1.2.0" }],
      maxToolRounds: 40,
      welcomeMessage: "欢迎",
      suggestedQuestions: ["本周报告？"],
    });
    expect(JSON.stringify(summary)).not.toContain("https://mcp.example.com/");
    expect(summary.builtin?.overrides[1]?.policy).toBeNull();
  });

  it("returns an empty summary for null and non-objects", () => {
    const empty = {
      model: "",
      system: "",
      builtin: null,
      mcp: [],
      custom: [],
      skills: [],
      maxToolRounds: 40,
      welcomeMessage: null,
      suggestedQuestions: [],
    };
    expect(buildManifestSummary(null)).toEqual(empty);
    expect(buildManifestSummary("nope")).toEqual(empty);
    expect(buildManifestSummary([])).toEqual(empty);
    expect(buildManifestSummary(3)).toEqual(empty);
  });
});

describe("toDesktopAgentCard", () => {
  it("drops a missing or inactive default environment", () => {
    const disabled = environment({ status: "disabled" });
    const card = toDesktopAgentCard(
      agent({ runtime: "cloud" }),
      undefined,
      new Map([[disabled.id, disabled]]),
      "u1",
    );
    expect(card.latestVersion).toBe(1);
    expect(card.effectiveVersion).toBe(1);
    expect(card.defaultEnvironment).toBeNull();
    expect(card.executionTarget).toBe("cloud");
    expect(card.ownedByMe).toBe(false);
  });
});
