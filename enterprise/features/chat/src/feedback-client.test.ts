import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChatFeedbackClient,
  parseChatFeedbackMap,
} from "./feedback-client";

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("chat feedback client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the latest feedback map for one session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        code: "00000",
        data: {
          feedback: [
            { message_id: "m-like", session_id: "s-1", value: "like" },
            { messageId: "m-dislike", sessionId: "s-1", type: "dislike" },
            { message_id: "bad", session_id: "s-1", value: "other" },
          ],
        },
      }),
    );
    const client = createChatFeedbackClient({ fetchImpl });

    await expect(client.list("s-1")).resolves.toEqual({
      "m-like": "like",
      "m-dislike": "dislike",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/chat/feedback?session_id=s-1",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("writes and clears feedback with the session/message scope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          code: "00000",
          data: {
            feedback: {
              message_id: "m-1",
              session_id: "s-1",
              value: "like",
            },
          },
        }),
      )
      .mockResolvedValueOnce(response({ code: "00000" }));
    const client = createChatFeedbackClient({ fetchImpl });

    await expect(
      client.set({ sessionId: "s-1", messageId: "m-1", value: "like" }),
    ).resolves.toMatchObject({ message_id: "m-1", session_id: "s-1", value: "like" });
    await expect(client.clear({ sessionId: "s-1", messageId: "m-1" })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/chat/feedback",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ session_id: "s-1", message_id: "m-1", value: "like" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/chat/feedback",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ session_id: "s-1", message_id: "m-1" }),
      }),
    );
  });

  it("supports an explicitly supplied authenticated host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        data: {
          feedback: {
            message_id: "m-1",
            session_id: "s-1",
            value: "dislike",
          },
        },
      }),
    );
    const client = createChatFeedbackClient({
      baseUrl: "http://127.0.0.1:43123/",
      path: "/api/chat/feedback",
      headers: { "x-agx-auth-token": "test-token" },
      fetchImpl,
    });

    await client.set({ sessionId: "s-1", messageId: "m-1", value: "dislike" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/chat/feedback",
      expect.objectContaining({
        credentials: "omit",
        headers: expect.any(Headers),
      }),
    );
    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get("x-agx-auth-token")).toBe("test-token");
  });

  it("rejects an absolute or protocol-relative feedback path", () => {
    expect(() => createChatFeedbackClient({ path: "https://evil.invalid/feedback" })).toThrow(
      "反馈 API 路径必须是安全的相对路径",
    );
    expect(() => createChatFeedbackClient({ path: "//evil.invalid/feedback" })).toThrow(
      "反馈 API 路径必须是安全的相对路径",
    );
  });

  it("fails closed when the server rejects a request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ error: { message: "message does not belong to session" } }, { status: 404 }),
    );
    const client = createChatFeedbackClient({ fetchImpl });

    await expect(client.set({ sessionId: "s-1", messageId: "m-1", value: "like" })).rejects.toThrow(
      "message does not belong to session",
    );
  });

  it("only returns valid feedback values when parsing a response", () => {
    expect(
      parseChatFeedbackMap({
        data: {
          records: [
            { message_id: "m-1", session_id: "s-1", value: "like" },
            { message_id: "m-2", session_id: "s-1", value: "dislike" },
            { message_id: "m-3", session_id: "s-1", value: "invalid" },
          ],
        },
      }),
    ).toEqual({ "m-1": "like", "m-2": "dislike" });
  });
});
