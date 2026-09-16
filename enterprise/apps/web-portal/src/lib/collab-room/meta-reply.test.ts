import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@agenticx/auth";
import {
  buildMetaPrompt,
  mentionsMeta,
  requestMetaReply,
  triggerMetaReply,
} from "./meta-reply";
import type { CollabRoomMessage } from "./types";

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

const session: AuthContext = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

function msg(partial: Partial<CollabRoomMessage> & Pick<CollabRoomMessage, "seq" | "content">): CollabRoomMessage {
  return {
    id: `id-${partial.seq}`,
    room_id: ROOM,
    tenant_id: session.tenantId,
    sender_type: "human",
    sender_id: session.userId,
    sender_name: "Alice",
    created_at: "2026-08-28T00:00:00.000Z",
    ...partial,
  };
}

describe("mentionsMeta", () => {
  it("mentionsMeta matches @Meta case-insensitively", () => {
    expect(mentionsMeta("@Meta 帮我看下")).toBe(true);
    expect(mentionsMeta("请 @meta 总结")).toBe(true);
  });

  it("mentionsMeta ignores emails and non-boundary hits", () => {
    expect(mentionsMeta("a@metabase.com")).toBe(false);
    expect(mentionsMeta("x@metadata")).toBe(false);
  });
});

describe("buildMetaPrompt", () => {
  it("buildMetaPrompt prefixes sender names", () => {
    const prompt = buildMetaPrompt([msg({ seq: 1, content: "你好", sender_name: "Alice" })]);
    expect(prompt.some((item) => item.role === "user" && item.content === "Alice：你好")).toBe(true);
  });

  it("buildMetaPrompt maps meta messages to assistant role", () => {
    const prompt = buildMetaPrompt([
      msg({ seq: 1, content: "问一下", sender_name: "Alice" }),
      msg({ seq: 2, content: "好的", sender_type: "meta", sender_id: "meta", sender_name: "Meta" }),
    ]);
    expect(prompt.find((item) => item.role === "assistant")?.content).toBe("好的");
  });

  it("buildMetaPrompt keeps only the last 30 messages in seq order", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      msg({ seq: 40 - index, content: `n${40 - index}` }),
    );
    const prompt = buildMetaPrompt(history, 30);
    const users = prompt.filter((item) => item.role === "user");
    expect(users).toHaveLength(30);
    expect(users[0]?.content).toContain("n11");
    expect(users[29]?.content).toContain("n40");
  });

  it("buildMetaPrompt truncates an oversized message", () => {
    const prompt = buildMetaPrompt([msg({ seq: 1, content: "x".repeat(5000), sender_name: "Alice" })]);
    const user = prompt.find((item) => item.role === "user");
    expect(user?.content.endsWith("…")).toBe(true);
    expect(user?.content.length).toBe("Alice：".length + 4000 + 1);
  });
});

describe("requestMetaReply", () => {
  it("requestMetaReply throws on non-2xx gateway response", async () => {
    await expect(
      requestMetaReply([{ role: "user", content: "hi" }], {
        gatewayUrl: "http://gateway.test",
        headers: {},
        model: "demo",
        fetchImpl: async () => new Response("nope", { status: 500 }),
      }),
    ).rejects.toThrow(/500/);
  });

  it("requestMetaReply returns the assistant content on success", async () => {
    const text = await requestMetaReply([{ role: "user", content: "hi" }], {
      gatewayUrl: "http://gateway.test",
      headers: {},
      model: "demo",
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "收到" } }] }), {
          status: 200,
        }),
    });
    expect(text).toBe("收到");
  });

  it("requestMetaReply strips think blocks from gateway content", async () => {
    const text = await requestMetaReply([{ role: "user", content: "hi" }], {
      gatewayUrl: "http://gateway.test",
      headers: {},
      model: "demo",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "<think>内部推理</think>\n对外回复" } }],
          }),
          { status: 200 },
        ),
    });
    expect(text).toBe("对外回复");
    expect(text).not.toContain("<think>");
  });
});

describe("triggerMetaReply", () => {
  it("triggerMetaReply appends a system notice when no model is available", async () => {
    const fetchImpl = vi.fn();
    const append = vi.fn();
    await triggerMetaReply({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, {
      listMessages: async () => [msg({ seq: 1, content: "@Meta 你好" })],
      appendMessage: append,
      listAvailableModelsForUser: async () => [],
      requestMetaReply: async () => "should-not-run",
      getAccessToken: async () => "tok",
      gatewayUrl: "http://127.0.0.1:8088/v1/chat/completions",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({ senderType: "system", content: expect.stringContaining("未配置可用模型") }),
    );
  });

  it("triggerMetaReply appends a system notice when the gateway fails", async () => {
    const append = vi.fn();
    await triggerMetaReply({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, {
      listMessages: async () => [msg({ seq: 1, content: "@Meta 你好" })],
      appendMessage: append,
      listAvailableModelsForUser: async () => [
        {
          id: "demo/model",
          provider: "demo",
          providerLabel: "Demo",
          model: "model",
          label: "model",
          route: "third-party",
          isDefault: true,
        },
      ],
      requestMetaReply: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8088");
      },
      getAccessToken: async () => "tok",
      gatewayUrl: "http://127.0.0.1:8088/v1/chat/completions",
    });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体暂时不可用，请稍后再试",
      }),
    );
    const notice = append.mock.calls[0]?.[2] as { content: string };
    expect(notice.content).not.toMatch(/127\.0\.0\.1|8088|https?:\/\//);
  });

  it("triggerMetaReply calls the gateway exactly once per invocation", async () => {
    const request = vi.fn(async () => "ok");
    const append = vi.fn();
    await triggerMetaReply({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, {
      listMessages: async () => [msg({ seq: 1, content: "@Meta 你好" })],
      appendMessage: append,
      listAvailableModelsForUser: async () => [
        {
          id: "demo/model",
          provider: "demo",
          providerLabel: "Demo",
          model: "model",
          label: "model",
          route: "third-party",
          isDefault: true,
        },
      ],
      requestMetaReply: request,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({ senderType: "meta", senderId: "meta", senderName: "Meta", content: "ok" }),
    );
  });
});
