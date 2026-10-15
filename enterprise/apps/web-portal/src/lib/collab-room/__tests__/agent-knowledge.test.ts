import { describe, expect, it, vi } from "vitest";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { knowledgeSearchUrl, searchKnowledge } from "../agent-knowledge";
import { runCloudAgentLoop } from "../agent-executor";

const agent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  slug: "report-bot",
  displayName: "验收助手",
  description: null,
  systemPrompt: "",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  workerKeys: [],
  status: "active",
  lifecycle: "published",
  origin: "enterprise",
  ownerUserId: null,
  localAvatarId: null,
  metadata: { knowledgeSearchUrl: "https://kb.example/search" },
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
} satisfies EnterpriseAgent;

describe("knowledge search connection", () => {
  it("reads only an http(s) address from the agent", () => {
    expect(knowledgeSearchUrl(agent)).toBe("https://kb.example/search");
    expect(knowledgeSearchUrl({ metadata: { knowledgeSearchUrl: "file:///tmp/x" } })).toBe("");
  });

  it("asks the bound endpoint and returns the snippets", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ text: "季度结论" }] }), { status: 200 }),
    );
    const found = await searchKnowledge("https://kb.example/search", "季度", fetchImpl);
    expect(found).toEqual({ ok: true, text: "季度结论" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://kb.example/search");
  });

  it("uses the bound endpoint when the model calls knowledge_search", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://kb.example/search") {
        return new Response(JSON.stringify({ results: [{ text: "库存 12" }] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role?: string }> };
      const hasTool = (body.messages ?? []).some((item) => item.role === "tool");
      if (!hasTool) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-kb",
                      type: "function",
                      function: { name: "knowledge_search", arguments: '{"query":"库存"}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "库存 12" } }] }), { status: 200 });
    });

    const result = await runCloudAgentLoop({
      agent,
      messages: [{ role: "user", content: "查库存" }],
      modelHeaders: { authorization: "Bearer tok", "x-agenticx-trace-step": "1" },
      model: "reply-model",
      mcpServers: [],
      deps: { fetchImpl, gatewayCompletionsUrl: "http://gateway.test/v1/chat/completions" },
    });
    expect(result.content).toBe("库存 12");
    expect(result.steps[0]).toMatchObject({ tool: "knowledge_search", server: "knowledge", ok: true });
  });
});
