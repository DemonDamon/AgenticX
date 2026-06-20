import { describe, expect, it, vi } from "vitest";
import { HttpChatClient } from "./http";

describe("HttpChatClient stream cancel", () => {
  it("yields cancelled chunk without error when fetch is aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("The operation was aborted.", "AbortError"));
            });
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const collectChunks = (async () => {
      const chunks = [];
      for await (const chunk of client.stream(requestId)) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await client.cancel(requestId);
    const chunks = await collectChunks;
    const last = chunks.at(-1);

    expect(last?.done).toBe(true);
    expect(last?.cancelled).toBe(true);
    expect(last?.error).toBeUndefined();
  });
});
