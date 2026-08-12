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

  it("keeps split reasoning inside one balanced think block before visible content", async () => {
    const payload =
      'data: {"choices":[{"delta":{"reasoning_content":"先判断意图。</think>"}}]}\n\n' +
      'data: {"choices":[{"delta":{"reasoning_content":"再规划检索。</think>"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"</think>最终回答"}}]}\n\n' +
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
    for await (const chunk of client.stream(requestId)) chunks.push(chunk);
    const combined = chunks.map((chunk) => chunk.delta ?? "").join("");

    expect(combined).toBe("<think>先判断意图。再规划检索。</think>\n最终回答");
    expect(combined.match(/<think>/g)).toHaveLength(1);
    expect(combined.match(/<\/think>/g)).toHaveLength(1);
  });

  it("orders split reasoning before content from the same SSE delta", async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"最终回答","reasoning_content":"内部判断"}}]}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(payload, { status: 200 }))),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    const chunks = [];
    for await (const chunk of client.stream(requestId)) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.delta ?? "").join("")).toBe(
      "<think>内部判断</think>\n最终回答",
    );
  });

  it("notifies the portal quota card after a completed stream", async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n";
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
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    for await (const _chunk of client.stream(requestId)) {
      // consume the stream
    }

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: "agenticx:quota-usage-changed" });
    vi.unstubAllGlobals();
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

  it("releases the body reader after [DONE] so the browser frees the connection", async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n";
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const realReader = bodyStream.getReader();
    const cancelSpy = vi.spyOn(realReader, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({}),
          body: { getReader: () => realReader },
        } as unknown as Response),
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

    expect(chunks.at(-1)?.done).toBe(true);
    // Without releaseStreamReader() this never fires, and the browser keeps the
    // HTTP/1.1 connection out of the per-origin pool until the tab is reloaded.
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("releases the body reader when the gateway sends a chunk.error frame", async () => {
    const payload = 'data: {"error":{"code":"50000","message":"boom"}}\n\n';
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const realReader = bodyStream.getReader();
    const cancelSpy = vi.spyOn(realReader, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({}),
          body: { getReader: () => realReader },
        } as unknown as Response),
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

    expect(chunks.at(-1)?.error?.message).toBe("boom");
    expect(cancelSpy).toHaveBeenCalled();
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
