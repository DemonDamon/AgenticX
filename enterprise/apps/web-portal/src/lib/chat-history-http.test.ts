import { describe, expect, it } from "vitest";
import { chatHistoryServerError } from "./chat-history-http";

describe("chatHistoryServerError", () => {
  it("does not expose internal error messages to clients", async () => {
    const response = chatHistoryServerError(new Error('relation "chat_sessions" does not exist'));
    const body = (await response.json()) as { error?: { code?: string; message?: string } };

    expect(response.status).toBe(500);
    expect(body.error?.code).toBe("50001");
    expect(body.error?.message).toBe("chat history operation failed");
  });
});
