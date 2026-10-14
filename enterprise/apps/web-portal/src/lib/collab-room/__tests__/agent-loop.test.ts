import { describe, expect, it, vi } from "vitest";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import {
  encodeGatewayToolName,
  MAX_TOOL_ROUNDS,
  runCloudAgentLoop,
  TOOL_NAME_MAX,
} from "../agent-executor";

const COMPLETIONS = "http://gateway.test/v1/chat/completions";

const agent: EnterpriseAgent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  slug: "report-bot",
  displayName: "验收助手",
  description: null,
  systemPrompt: "只回答和报表有关的问题。",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: ["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"],
  assignmentKeys: ["all"],
  status: "active",
  metadata: {},
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

const headers = {
  authorization: "Bearer tok",
  "x-tenant-id": agent.tenantId,
  "x-agenticx-trace-id": "trace-fixed",
  "x-agenticx-trace-step": "1",
};

const servers = [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "diag-echo" }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function readInit(call: unknown[] | undefined) {
  const init = call?.[1] as RequestInit | undefined;
  return {
    url: String(call?.[0]),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init?.body)) as {
      model?: string;
      tools?: Array<{ function: { name: string } }>;
      tool_choice?: string;
      messages?: Array<{ role: string; content?: string; tool_call_id?: string }>;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    },
  };
}

function listPayload() {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [
        {
          name: "echo",
          description: "回显",
          inputSchema: { type: "object", properties: { message: { type: "string" } } },
        },
      ],
    },
  };
}

function toolCallPayload(id: string, argumentsText = '{"message":"hello-acp05"}') {
  return {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: { name: "diag-echo__echo", arguments: argumentsText },
            },
          ],
        },
      },
    ],
  };
}

describe("encodeGatewayToolName", () => {
  it("replaces unsafe characters and keeps the name within 64 characters", () => {
    expect(encodeGatewayToolName("diag echo", "echo!")).toBe("diag_echo__echo");
    const long = encodeGatewayToolName("s".repeat(90), "t".repeat(90));
    expect(long.length).toBeLessThanOrEqual(TOOL_NAME_MAX);
    expect(long).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(long).toContain("__");
  });
});

describe("runCloudAgentLoop", () => {
  it("calls echo then answers with the tool result", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { method?: string; tools?: unknown };
      if (url.includes("/streamable-http") && body.method === "tools/list") return jsonResponse(listPayload());
      if (url.includes("/streamable-http") && body.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: "hello-" }, { type: "text", text: "acp05" }] },
        });
      }
      if (body.tools) {
        const messages = (JSON.parse(String(init?.body)) as { messages?: unknown[] }).messages ?? [];
        const hasTool = messages.some((item) => (item as { role?: string }).role === "tool");
        return jsonResponse(hasTool ? { choices: [{ message: { content: "<think>hidden</think>回显 hello-acp05" } }] } : toolCallPayload("call-1"));
      }
      return jsonResponse({ choices: [{ message: { content: "unexpected" } }] });
    });

    const result = await runCloudAgentLoop({
      agent,
      messages: [{ role: "user", content: "请调用 echo 回显 hello-acp05" }],
      modelHeaders: headers,
      model: "reply-model",
      mcpServers: servers,
      deps: { fetchImpl, gatewayCompletionsUrl: COMPLETIONS, gatewayMcpBase: "http://gateway.test" },
    });

    expect(result.content).toBe("回显 hello-acp05");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ tool: "echo", server: "diag-echo", ok: true });
    expect(Object.keys(result.steps[0] ?? {}).sort()).toEqual(["durationMs", "ok", "server", "tool"]);

    const modelCalls = fetchImpl.mock.calls
      .map((call) => readInit(call))
      .filter((call) => call.url === COMPLETIONS);
    expect(modelCalls).toHaveLength(2);
    expect(modelCalls[0]?.body.tools?.[0]?.function.name).toBe("diag-echo__echo");
    expect(modelCalls[0]?.body.tool_choice).toBe("auto");
    expect(modelCalls[0]?.headers["x-agenticx-trace-id"]).toBe("trace-fixed");
    expect(modelCalls[0]?.headers["x-agenticx-trace-step"]).toBe("1");
    expect(modelCalls[1]?.headers["x-agenticx-trace-id"]).toBe("trace-fixed");
    expect(modelCalls[1]?.headers["x-agenticx-trace-step"]).toBe("2");
    const toolMessage = modelCalls[1]?.body.messages?.find((item) => item.role === "tool");
    expect(toolMessage).toMatchObject({ tool_call_id: "call-1", content: "hello-acp05" });

    const mcpCall = fetchImpl.mock.calls.map((call) => readInit(call)).find((call) => call.body.method === "tools/call");
    expect(mcpCall?.body.params).toEqual({ name: "echo", arguments: { message: "hello-acp05" } });
    expect(fetchImpl.mock.calls.map((call) => readInit(call).body.method)).not.toContain("initialize");
  });

  it("asks for a final answer without tools after the round limit", async () => {
    let modelRound = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { method?: string; tools?: unknown };
      if (url.includes("/streamable-http") && body.method === "tools/list") return jsonResponse(listPayload());
      if (url.includes("/streamable-http") && body.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: "pong" }] },
        });
      }
      modelRound += 1;
      if (body.tools) return jsonResponse(toolCallPayload(`call-${modelRound}`));
      return jsonResponse({ choices: [{ message: { content: "根据工具结果作答" } }] });
    });

    const result = await runCloudAgentLoop({
      agent,
      messages: [{ role: "user", content: "一直调用" }],
      modelHeaders: headers,
      model: "reply-model",
      mcpServers: servers,
      deps: { fetchImpl, gatewayCompletionsUrl: COMPLETIONS, gatewayMcpBase: "http://gateway.test" },
    });

    expect(result.content).toBe("根据工具结果作答");
    expect(result.steps).toHaveLength(MAX_TOOL_ROUNDS);
    const modelCalls = fetchImpl.mock.calls
      .map((call) => readInit(call))
      .filter((call) => call.url === COMPLETIONS);
    expect(modelCalls.filter((call) => call.body.tools)).toHaveLength(MAX_TOOL_ROUNDS);
    const finalCall = modelCalls.at(-1);
    expect(finalCall?.body.tools).toBeUndefined();
    expect(finalCall?.body.tool_choice).toBeUndefined();
    expect(finalCall?.headers["x-agenticx-trace-step"]).toBe(String(MAX_TOOL_ROUNDS + 1));
    expect(finalCall?.body.messages?.some((item) => item.role === "tool")).toBe(true);
    expect(finalCall?.body.messages?.some((item) => item.content?.includes("工具调用已达上限"))).toBe(true);
  });

  it("records an invalid JSON argument and continues without calling the tool", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        tools?: unknown;
        messages?: Array<{ role?: string }>;
      };
      if (url.includes("/streamable-http")) {
        if (body.method === "tools/call") return jsonResponse({ error: { message: "should not call" } }, 500);
        return jsonResponse(listPayload());
      }
      const hasTool = body.messages?.some((item) => item.role === "tool") ?? false;
      if (!hasTool) return jsonResponse(toolCallPayload("call-bad", "{bad"));
      return jsonResponse({ choices: [{ message: { content: "参数无效，改为直接回答" } }] });
    });

    const result = await runCloudAgentLoop({
      agent,
      messages: [{ role: "user", content: "坏参数" }],
      modelHeaders: headers,
      model: "reply-model",
      mcpServers: servers,
      deps: { fetchImpl, gatewayCompletionsUrl: COMPLETIONS, gatewayMcpBase: "http://gateway.test" },
    });

    expect(result.content).toBe("参数无效，改为直接回答");
    expect(result.steps).toEqual([expect.objectContaining({ tool: "echo", server: "diag-echo", ok: false })]);
    const modelCalls = fetchImpl.mock.calls
      .map((call) => readInit(call))
      .filter((call) => call.url === COMPLETIONS);
    expect(modelCalls[1]?.body.messages?.find((item) => item.role === "tool")?.content).toBe("参数不是合法 JSON");
    expect(fetchImpl.mock.calls.map((call) => readInit(call).body.method)).not.toContain("tools/call");
  });

  it("does not send tools when the agent has no MCP server", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "我是验收助手" } }] }));
    const result = await runCloudAgentLoop({
      agent: { ...agent, capabilityIds: [] },
      messages: [
        { role: "system", content: "只回答和报表有关的问题。" },
        { role: "user", content: "Alice：介绍你自己" },
      ],
      modelHeaders: headers,
      model: "reply-model",
      mcpServers: [],
      deps: { fetchImpl, gatewayCompletionsUrl: COMPLETIONS, gatewayMcpBase: "http://gateway.test" },
    });
    expect(result).toEqual({ content: "我是验收助手", steps: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const sent = readInit(fetchImpl.mock.calls[0]);
    expect(sent.body.model).toBe("reply-model");
    expect(sent.body.tools).toBeUndefined();
    expect(sent.body.tool_choice).toBeUndefined();
  });

  it("skips a server whose tool list fails and answers without tools", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/streamable-http")) return new Response("down", { status: 500 });
        return jsonResponse({ choices: [{ message: { content: "没有工具也可答" } }] });
      });
      const result = await runCloudAgentLoop({
        agent,
        messages: [{ role: "user", content: "你好" }],
        modelHeaders: headers,
        model: "reply-model",
        mcpServers: servers,
        deps: { fetchImpl, gatewayCompletionsUrl: COMPLETIONS, gatewayMcpBase: "http://gateway.test" },
      });
      expect(result).toEqual({ content: "没有工具也可答", steps: [] });
      const modelCall = fetchImpl.mock.calls.map((call) => readInit(call)).find((call) => call.url === COMPLETIONS);
      expect(modelCall?.body.tools).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
