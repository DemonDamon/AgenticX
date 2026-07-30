import { describe, expect, it, vi } from "vitest";
import { HttpChatClient, normalizeTransportErrorMessage } from "./http";

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

  it("parses agenticx_web_search_sources frames without treating them as delta", async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"agenticx_web_search_sources":[{"title":"T","url":"https://ex.com","snippet":"S"}]}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(payload, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const chunks = [];
    for await (const chunk of client.stream(requestId)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.delta === "hi")).toBe(true);
    const sourcesChunk = chunks.find((c) => c.webSearchSources?.length);
    expect(sourcesChunk?.webSearchSources).toEqual([
      { title: "T", url: "https://ex.com", snippet: "S" },
    ]);
    expect(sourcesChunk?.delta).toBeUndefined();
  });

  it("parses agenticx_deep_research_event frames without treating them as delta", async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"agenticx_deep_research_event":{"type":"phase","phase":"plan","message":"规划中"}}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(payload, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const chunks = [];
    for await (const chunk of client.stream(requestId)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.delta === "hi")).toBe(true);
    const eventChunk = chunks.find((c) => c.deepResearchEvent);
    expect(eventChunk?.deepResearchEvent).toEqual({
      type: "phase",
      phase: "plan",
      message: "规划中",
    });
    expect(eventChunk?.delta).toBeUndefined();
  });

  it("keeps reading after finish_reason=stop so trailer sources are not dropped", async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n' +
      'data: {"agenticx_web_search_sources":[{"title":"T","url":"https://ex.com","snippet":"S"}]}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(payload, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const chunks = [];
    for await (const chunk of client.stream(requestId)) {
      chunks.push(chunk);
    }

    expect(chunks.find((c) => c.webSearchSources?.length)?.webSearchSources?.[0]?.url).toBe(
      "https://ex.com",
    );
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("normalizes opaque browser network errors to actionable Chinese copy", () => {
    expect(normalizeTransportErrorMessage("Failed to fetch")).toContain("无法连接门户服务");
    expect(normalizeTransportErrorMessage("network error")).toContain("无法连接门户服务");
    expect(normalizeTransportErrorMessage("Failed to fetch")).toContain("历史同步");
    expect(normalizeTransportErrorMessage("upstream stream error: boom")).toBe(
      "upstream stream error: boom",
    );
  });

  it("surfaces fetch TypeError as normalized error chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const chunks = [];
    for await (const chunk of client.stream(requestId)) {
      chunks.push(chunk);
    }
    const last = chunks.at(-1);
    expect(last?.done).toBe(true);
    expect(last?.error?.message).toContain("无法连接门户服务");
  });
});
