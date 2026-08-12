import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { ChatHistoryHttpError } from "./history-client";
import {
  __resetHistoryOutboxForTests,
  __setHistoryOutboxStorageForTests,
  createMemoryHistoryOutboxStorage,
  enqueueAppend,
  flushHistoryOutbox,
  getHistoryOutboxPrincipal,
  hasPendingAppendOps,
  listPendingOverlayMessages,
  startHistoryOutboxCoordinator,
  disposeHistoryOutbox,
  stripToAppendPayload,
  type HistoryAppendPayload,
} from "./history-outbox";

function msg(partial?: Partial<{ id: string; content: string }>) {
  const id = partial?.id ?? ulid();
  return {
    id,
    session_id: "01SESSIONAAAAAAAAAAAAAAAAA",
    tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
    user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
    role: "user" as const,
    content: partial?.content ?? "hello",
    created_at: "2026-07-30T00:00:00.000Z",
  };
}

describe("history-outbox", () => {
  beforeEach(() => {
    __resetHistoryOutboxForTests();
    __setHistoryOutboxStorageForTests(createMemoryHistoryOutboxStorage());
  });

  afterEach(() => {
    disposeHistoryOutbox();
    __resetHistoryOutboxForTests();
  });

  it("does not flush without principal/coordinator", async () => {
    const append = vi.fn();
    expect(getHistoryOutboxPrincipal()).toBeNull();
    await expect(flushHistoryOutbox()).resolves.toEqual([]);
    expect(append).not.toHaveBeenCalled();
  });

  it("enqueues append and flushes to empty outbox (AC-1)", async () => {
    const append = vi.fn(async () => undefined);
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    const result = await enqueueAppend(sessionId, [msg()]);
    expect(result.enqueued).toBe(true);
    expect(await hasPendingAppendOps(sessionId)).toBe(true);

    const flushed = await flushHistoryOutbox();
    expect(flushed).toContain(sessionId);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await hasPendingAppendOps(sessionId)).toBe(false);
  });

  it("does not read or flush another principal's queue (AC-7)", async () => {
    const storage = createMemoryHistoryOutboxStorage();
    __setHistoryOutboxStorageForTests(storage);
    const appendA = vi.fn(async () => undefined);
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: appendA },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    await enqueueAppend(sessionId, [msg()]);
    disposeHistoryOutbox();

    const appendB = vi.fn(async () => undefined);
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTBBBBBBBBBBBBBBBBBB", userId: "01USERBBBBBBBBBBBBBBBBBBBB" },
      { appendMessages: appendB },
    );
    await flushHistoryOutbox();
    expect(appendB).not.toHaveBeenCalled();
    expect(await listPendingOverlayMessages(sessionId)).toEqual([]);
  });

  it("projects pending overlay messages for hydrate", async () => {
    const append = vi.fn(async () => {
      throw new ChatHistoryHttpError("unavailable", 503);
    });
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    const user = msg({ content: "offline answer pair" });
    await enqueueAppend(sessionId, [user]);
    await flushHistoryOutbox();
    const overlay = await listPendingOverlayMessages(sessionId);
    expect(overlay).toHaveLength(1);
    expect(overlay[0]?.content).toBe("offline answer pair");
  });

  it("passes operation_id and payload_hash to transport", async () => {
    const append = vi.fn(
      async (
        _sessionId: string,
        messages: HistoryAppendPayload[],
        opts: { operationId: string; payloadHash: string },
      ) => {
        expect(messages[0]?.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        expect(opts.operationId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        expect(opts.payloadHash).toMatch(/^[a-f0-9]{64}$/);
      },
    );
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    await enqueueAppend("01SESSIONAAAAAAAAAAAAAAAAA", [msg()]);
    await flushHistoryOutbox();
    expect(append).toHaveBeenCalled();
  });

  it("stripToAppendPayload keeps deep_research workbench events", () => {
    const payload = stripToAppendPayload({
      id: ulid(),
      session_id: "01SESSIONAAAAAAAAAAAAAAAAA",
      tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
      user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
      role: "assistant",
      content: "调研完成摘要",
      created_at: "2026-08-01T00:00:00.000Z",
      deep_research: {
        runId: "run-abc",
        status: "completed",
        events: [
          { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
          { type: "phase", phase: "done", message: "深度研究完成" },
        ],
        artifactIds: ["art-1"],
      },
    });
    expect(payload.deep_research).toEqual({
      runId: "run-abc",
      status: "completed",
      events: [
        { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
        { type: "phase", phase: "done", message: "深度研究完成" },
      ],
      artifactIds: ["art-1"],
    });
  });

  it("stripToAppendPayload and pending overlay preserve web_search_trace", async () => {
    const append = vi.fn(async () => {
      throw new ChatHistoryHttpError("unavailable", 503);
    });
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    const assistant = {
      ...msg(),
      role: "assistant" as const,
      web_search_sources: [
        { title: "used", url: "https://used.example", snippet: "s", usedByModel: true },
        { title: "extra", url: "https://extra.example", snippet: "s", usedByModel: false },
      ],
      web_search_trace: {
        version: 1 as const,
        decision: "search" as const,
        reason: "current information requested",
        resolvedQuery: "current topic as of 2026-08-12",
        facets: [{
          query: "topic 2026-08-12",
          providerIds: ["customer-primary"],
          hitCount: 8,
          uniqueHosts: 5,
        }],
        providerCalls: 1,
      },
    };
    expect(stripToAppendPayload(assistant).web_search_sources?.map((source) => source.usedByModel))
      .toEqual([true, false]);
    expect(stripToAppendPayload(assistant).web_search_trace).toEqual(assistant.web_search_trace);

    await enqueueAppend(sessionId, [assistant]);
    await flushHistoryOutbox();
    const overlay = (await listPendingOverlayMessages(sessionId))[0];
    expect(overlay?.web_search_trace).toEqual(assistant.web_search_trace);
    expect(overlay?.web_search_sources?.map((source) => source.usedByModel)).toEqual([true, false]);
  });

  it("stripToAppendPayload keeps truncated parsed_text and drops image data_url", () => {
    const longText = "文档正文".repeat(40_000); // > 120k chars
    const payload = stripToAppendPayload({
      id: ulid(),
      session_id: "01SESSIONAAAAAAAAAAAAAAAAA",
      tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
      user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
      role: "user",
      content: "这个文档大致内容是？",
      created_at: "2026-08-01T00:00:00.000Z",
      attachments: [
        {
          name: "rag.pdf",
          mime_type: "application/pdf",
          size: 15_200_000,
          kind: "document",
          parsed_text: longText,
        },
        {
          name: "shot.png",
          mime_type: "image/png",
          kind: "image",
          data_url: "data:image/png;base64,abcd",
        },
      ],
    });
    expect(payload.attachments?.[0]?.parsed_text?.length).toBe(120_000);
    expect(payload.attachments?.[0]?.name).toBe("rag.pdf");
    expect(payload.attachments?.[1]).toEqual({
      name: "shot.png",
      mime_type: "image/png",
      kind: "image",
    });
    expect((payload.attachments?.[1] as { data_url?: string }).data_url).toBeUndefined();
  });

  it("keeps attachment_id when budget strip drops parsed_text", async () => {
    const append = vi.fn(async () => undefined);
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    const attachmentId = "01HYATTACHAAAAAAAAAAAAAAAA";
    // ~900k content + 120k parsed_text → over MAX_JOB_BYTES; after drop text → under budget.
    const result = await enqueueAppend(sessionId, [
      {
        ...msg({ content: "总结" }),
        attachments: [
          {
            name: "huge.pdf",
            mime_type: "application/pdf",
            size: 40_000_000,
            kind: "document",
            parsed_text: "x".repeat(120_000),
            attachment_id: attachmentId,
          },
        ],
      },
      {
        ...msg({ content: "pad" }),
        role: "assistant" as const,
        content: "y".repeat(900_000),
      },
    ]);
    expect(result.enqueued).toBe(true);
    await flushHistoryOutbox();
    expect(append).toHaveBeenCalled();
    const call = append.mock.calls[0] as unknown as [string, HistoryAppendPayload[]];
    const att = call[1]?.[0]?.attachments?.[0];
    expect(att?.attachment_id).toBe(attachmentId);
    expect(att?.parsed_text).toBeUndefined();
  });

  it("flushes document metadata+parsed_text append without dead-letter", async () => {
    const append = vi.fn(async () => undefined);
    startHistoryOutboxCoordinator(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      { appendMessages: append },
    );
    const sessionId = "01SESSIONAAAAAAAAAAAAAAAAA";
    const result = await enqueueAppend(sessionId, [
      {
        ...msg({ content: "这个文档大致内容是？" }),
        attachments: [
          {
            name: "rag.pdf",
            mime_type: "application/pdf",
            size: 15_200_000,
            kind: "document",
            parsed_text: "RAG 算法测试文档正文",
          },
        ],
      },
    ]);
    expect(result.enqueued).toBe(true);
    await flushHistoryOutbox();
    expect(append).toHaveBeenCalledTimes(1);
    const call = append.mock.calls[0] as unknown as [string, HistoryAppendPayload[]];
    expect(call[1]?.[0]?.attachments?.[0]?.parsed_text).toBe("RAG 算法测试文档正文");
  });
});
