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
});
