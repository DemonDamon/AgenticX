import { describe, expect, it } from "vitest";
import type { ScratchChat } from "./scratch-chat";
import {
  applyScratchSsePayload,
  appendScratchTurn,
  buildScratchChatRequestBody,
  consumeScratchSse,
  ensureScratchSessionId,
  runScratchChatTurn,
  type ScratchChatTransport,
} from "./scratch-chat-runtime";
import type { Message } from "../store";

const chat: ScratchChat = {
  id: "sc-1",
  title: "关于这段回复",
  sourceKind: "message",
  sourceKey: "message:m1",
  quotedContent: "选中的原文",
  contextFiles: [{ path: "/tmp/a.md", sourcePath: "/tmp/a.md" }],
  sessionId: "",
  messages: [],
  floating: false,
};

describe("buildScratchChatRequestBody", () => {
  it("includes quote snapshot and file keys, not pane messages", () => {
    const body = buildScratchChatRequestBody({
      sessionId: "sid-1",
      userInput: "接着问",
      provider: "openai",
      model: "gpt-test",
      quotedContent: "选中的原文",
      contextFiles: [{ path: "/tmp/a.md", sourcePath: "/tmp/a.md" }],
      clientTurnId: "turn-1",
    });
    expect(body.session_id).toBe("sid-1");
    expect(body.user_input).toBe("接着问");
    expect(body.quoted_content).toBe("选中的原文");
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-test");
    expect(body.client_turn_id).toBe("turn-1");
    expect(body.context_files).toEqual({ "/tmp/a.md": "" });
    expect(body).not.toHaveProperty("messages");
  });
});

describe("ensureScratchSessionId", () => {
  it("reuses an existing session", async () => {
    let called = 0;
    const id = await ensureScratchSessionId({
      sessionId: "keep-me",
      avatarId: "ava",
      createSession: async () => {
        called += 1;
        return { ok: true, session_id: "new" };
      },
    });
    expect(id).toBe("keep-me");
    expect(called).toBe(0);
  });

  it("creates once when sessionId is empty", async () => {
    const id = await ensureScratchSessionId({
      sessionId: "",
      avatarId: "ava-1",
      createSession: async (payload) => {
        expect(payload.avatar_id).toBe("ava-1");
        return { ok: true, session_id: "fresh" };
      },
    });
    expect(id).toBe("fresh");
  });
});

describe("applyScratchSsePayload", () => {
  const seed: Message[] = [
    { id: "u1", role: "user", content: "hi" },
    { id: "a1", role: "assistant", content: "" },
  ];

  it("appends tokens then replaces on final", () => {
    const mid = applyScratchSsePayload(seed, "a1", { type: "token", data: { text: "你好" } });
    expect(mid.messages.find((item) => item.id === "a1")?.content).toBe("你好");
    const fin = applyScratchSsePayload(mid.messages, "a1", {
      type: "final",
      data: { text: "你好世界" },
    });
    expect(fin.messages.find((item) => item.id === "a1")?.content).toBe("你好世界");
    expect(fin.done).toBe(true);
    expect(fin.messages).toHaveLength(2);
  });

  it("surfaces SSE errors", () => {
    const next = applyScratchSsePayload(seed, "a1", { type: "error", data: { text: "boom" } });
    expect(next.error).toBe("boom");
    expect(next.messages).toBe(seed);
  });
});

describe("appendScratchTurn", () => {
  it("adds a user and empty assistant row", () => {
    const rows = appendScratchTurn([], {
      userId: "u",
      assistantId: "a",
      text: "问",
      sessionId: "s",
    });
    expect(rows.map((item) => [item.role, item.content, item.ownerSessionId])).toEqual([
      ["user", "问", "s"],
      ["assistant", "", "s"],
    ]);
  });
});

describe("runScratchChatTurn", () => {
  it("writes only through callbacks and never appends on HTTP failure", async () => {
    const seen: Message[][] = [];
    const sessions: string[] = [];
    const transport: ScratchChatTransport = {
      createSession: async () => ({ ok: true, session_id: "sid-9" }),
      chat: async () => ({ ok: false, status: 500, body: null }),
    };
    const result = await runScratchChatTurn({
      chat,
      userText: "接着问",
      paneAvatarId: "ava-1",
      apiBase: "http://127.0.0.1:9",
      apiToken: "tok",
      ids: { userId: "u", assistantId: "a", clientTurnId: "t" },
      transport,
      onMessages: (rows) => seen.push(rows),
      onSessionId: (id) => sessions.push(id),
    });
    expect(result).toEqual({ ok: false, error: "HTTP 500" });
    expect(sessions).toEqual(["sid-9"]);
    expect(seen).toEqual([]);
  });

  it("streams tokens onto the scratch assistant row", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"type":"token","data":{"text":"答"}}\n\n'),
      encoder.encode('data: {"type":"final","data":{"text":"答案"}}\n\n'),
    ];
    let offset = 0;
    const transport: ScratchChatTransport = {
      createSession: async () => ({ ok: true, session_id: "sid-2" }),
      chat: async ({ body }) => {
        expect(body.quoted_content).toBe("选中的原文");
        expect(body.user_input).toBe("接着问");
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                if (offset >= chunks.length) return { done: true as const };
                return { done: false as const, value: chunks[offset++] };
              },
            }),
          },
        };
      },
    };
    const seen: Message[][] = [];
    const result = await runScratchChatTurn({
      chat,
      userText: "接着问",
      paneAvatarId: null,
      provider: "openai",
      model: "m",
      apiBase: "http://127.0.0.1:9",
      apiToken: "tok",
      ids: { userId: "u", assistantId: "a", clientTurnId: "t" },
      transport,
      onMessages: (rows) => seen.push(rows),
      onSessionId: () => undefined,
    });
    expect(result).toEqual({ ok: true });
    const last = seen[seen.length - 1] ?? [];
    expect(last.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(last[1]?.content).toBe("答案");
  });
});

describe("consumeScratchSse", () => {
  it("parses framed payloads", async () => {
    const encoder = new TextEncoder();
    const payloads: unknown[] = [];
    let sent = false;
    await consumeScratchSse(
      {
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: encoder.encode('data: {"type":"done"}\n\n') };
        },
      },
      (payload) => payloads.push(payload),
    );
    expect(payloads).toEqual([{ type: "done" }]);
  });
});
