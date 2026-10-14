import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { dispatchAgentMention } from "../agent-reply";
import type { CollabRoomMessage } from "../types";

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

const session: AuthContext = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const agent: EnterpriseAgent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: session.tenantId,
  slug: "report-bot",
  displayName: "验收助手",
  description: null,
  systemPrompt: "只回答和报表有关的问题。",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  status: "active",
  metadata: {},
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function msg(partial: Partial<CollabRoomMessage> & Pick<CollabRoomMessage, "seq" | "content">): CollabRoomMessage {
  return {
    id: `id-${partial.seq}`,
    room_id: ROOM,
    tenant_id: session.tenantId,
    sender_type: "human",
    sender_id: session.userId,
    sender_name: "Alice",
    created_at: "2026-10-14T00:00:00.000Z",
    ...partial,
  };
}

const trigger = msg({ id: "01MSG0AAAAAAAAAAAAAAAAAAAA", seq: 2, content: "@report-bot 介绍你自己" });

describe("dispatchAgentMention", () => {
  it("sends the agent prompt and writes an agent message on success", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "我是验收助手" } }] }), {
        status: 200,
      }),
    );
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [
        msg({
          seq: 1,
          content: "上一句",
          sender_type: "agent",
          sender_id: agent.id,
          sender_name: agent.displayName,
        }),
        trigger,
      ],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-agenticx-agent-id"]).toBe(agent.id);
    expect(headers["x-agenticx-provider"]).toBe("demo");
    expect(headers["x-agenticx-trace-stage"]).toBe("room.agent");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("reply-model");
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain(agent.systemPrompt);
    expect(body.messages[0]?.content).toContain("协作房间里的智能体「验收助手」");
    expect(body.messages.find((item) => item.role === "assistant")?.content).toBe("上一句");
    expect(body.messages.find((item) => item.role === "user")?.content).toBe("Alice：@report-bot 介绍你自己");
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.displayName,
        content: "我是验收助手",
        model: agent.model,
        metadata: { agent_slug: "report-bot", runtime: "cloud", reply_to: trigger.id },
      }),
    );
  });

  it("writes a system notice when the gateway returns 403", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [trigger],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
    });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」使用的模型对你不可用，请联系管理员",
      }),
    );
  });

  it("writes a system notice for a desktop worker", async () => {
    const fetchImpl = vi.fn();
    const append = vi.fn();
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」需要员工桌面执行，桌面执行通道尚未接入",
      }),
    );
  });

  it("stores tool step summaries when the cloud agent calls a bound tool", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            method?: string;
            tools?: unknown;
            messages?: Array<{ role?: string }>;
          })
        : {};
      if (url.includes("/streamable-http") && body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/streamable-http") && body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: "hello-acp05" }] },
          }),
          { status: 200 },
        );
      }
      const hasTool = body.messages?.some((item) => item.role === "tool") ?? false;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: hasTool
                ? { content: "回显 hello-acp05" }
                : {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: { name: "diag-echo__echo", arguments: "{\"message\":\"hello-acp05\"}" },
                      },
                    ],
                  },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const append = vi.fn();
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, capabilityIds: ["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"] },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        loadMcpServers: async () => [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "diag-echo" }],
      },
    );
    const saved = append.mock.calls[0]?.[2] as { content?: string; metadata?: Record<string, unknown> };
    expect(saved.content).toBe("回显 hello-acp05");
    const steps = saved.metadata?.tool_steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(Object.keys(steps[0] ?? {}).sort()).toEqual(["durationMs", "ok", "server", "tool"]);
    expect(steps[0]).toMatchObject({ tool: "echo", server: "diag-echo", ok: true });
    expect(JSON.stringify(saved.metadata)).not.toContain("hello-acp05");
  });
});
