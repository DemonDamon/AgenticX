import { describe, expect, it, vi } from "vitest";
import { createPortalChatHistoryClient, historyFetch } from "./history-client";

describe("historyFetch", () => {
  it("retries Failed to fetch then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await historyFetch("/api/chat/sessions", { method: "GET" }, { retries: 3 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes exhausted transport errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(historyFetch("/api/chat/sessions", {}, { retries: 1 })).rejects.toThrow(
      /无法连接门户服务/,
    );
  });
});

describe("createPortalChatHistoryClient.appendMessages", () => {
  it("retries then persists", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "00000" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createPortalChatHistoryClient();
    await client.appendMessages("S1", [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAAA",
        session_id: "S1",
        tenant_id: "T1",
        user_id: "U1",
        role: "user",
        content: "hi",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
