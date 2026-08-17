import { afterEach, describe, expect, it, vi } from "vitest";
import { isTraceId } from "../trace/trace-id";
import { HttpChatClient } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpChatClient trace header", () => {
  it("sends x-agenticx-trace-id and yields the same id on transport error", async () => {
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        return Promise.reject(new TypeError("Failed to fetch"));
      }),
    );

    const client = new HttpChatClient({ endpoint: "/api/chat/completions" });
    const { requestId, traceId } = await client.sendMessage({
      sessionId: "session-1",
      model: "test-model",
      messages: [{ id: "u1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    expect(isTraceId(traceId)).toBe(true);

    const chunks = [];
    for await (const chunk of client.stream(requestId)) {
      chunks.push(chunk);
    }

    const headers = new Headers(capturedHeaders);
    expect(headers.get("x-agenticx-trace-id")).toBe(traceId);
    expect(isTraceId(headers.get("x-agenticx-trace-id"))).toBe(true);

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk?.traceId).toBe(traceId);
  });
});
