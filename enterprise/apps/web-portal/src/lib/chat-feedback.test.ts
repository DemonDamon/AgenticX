import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMysqlDb: vi.fn(),
  getIamDb: vi.fn(),
  resolveDatabaseConfig: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  createMysqlDb: (...args: unknown[]) => mocks.createMysqlDb(...args),
  getIamDb: (...args: unknown[]) => mocks.getIamDb(...args),
  resolveDatabaseConfig: (...args: unknown[]) => mocks.resolveDatabaseConfig(...args),
}));

import {
  ChatFeedbackTargetNotFoundError,
  deleteChatMessageFeedback,
  listChatMessageFeedback,
  upsertChatMessageFeedback,
} from "./chat-feedback";

const actor = {
  tenantId: "01J00000000000000000000001",
  userId: "01J00000000000000000000002",
  departmentId: "01J00000000000000000000003",
};
const sessionId = "01J00000000000000000000004";
const messageId = "01J00000000000000000000005";
const foreignMessageId = "01J00000000000000000000006";

type SavedRow = Record<string, unknown> | null;

function queryDb(results: unknown[][]) {
  const queue = [...results];
  const select = vi.fn(() => {
    const result = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "groupBy"] as const) {
      chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(async () => result);
    chain.then = (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
  });
  return { select };
}

function voteDb(message: Record<string, unknown> | null) {
  let saved: SavedRow = null;
  const updates: Array<Record<string, unknown>> = [];
  const select = vi.fn((shape?: Record<string, unknown>) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "groupBy"] as const) {
      chain[method] = vi.fn(() => chain);
    }
    const rows = () => {
      if (shape && "role" in shape) return message ? [message] : [];
      if (shape && "count" in shape) {
        return saved ? [{ value: saved.value, count: 1 }] : [];
      }
      return saved ? [{ ...saved }] : [];
    };
    chain.limit = vi.fn(async () => rows());
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows()).then(resolve, reject);
    return chain;
  });
  const insert = vi.fn(() => ({
    values: (vals: Record<string, unknown>) => ({
      onConflictDoUpdate: vi.fn(async (args: { set: Record<string, unknown> }) => {
        updates.push(args.set);
        if (
          saved &&
          saved.messageId === vals.messageId &&
          saved.userId === vals.userId &&
          saved.tenantId === vals.tenantId
        ) {
          saved = { ...saved, ...args.set };
          return;
        }
        saved = { ...vals };
      }),
      onDuplicateKeyUpdate: vi.fn(async () => {
        throw new Error("postgresql path must not use onDuplicateKeyUpdate");
      }),
    }),
  }));
  return { select, insert, updates };
}

function assistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: messageId,
    sessionId,
    tenantId: actor.tenantId,
    userId: actor.userId,
    role: "assistant",
    status: "complete",
    model: "openai/gpt-4o-mini",
    metadata: { provider: "openai", trace_id: "trace-1" },
    ...overrides,
  };
}

describe("chat message feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "postgresql",
      url: "postgresql://example.invalid/agenticx",
    });
  });

  it("saves a vote on the caller's completed assistant message and overwrites it", async () => {
    const db = voteDb(assistantMessage());
    mocks.getIamDb.mockReturnValue(db);

    const created = await upsertChatMessageFeedback({
      actor,
      sessionId,
      messageId,
      value: "like",
    });
    expect(created.feedback.messageId).toBe(messageId);
    expect(created.feedback.sessionId).toBe(sessionId);
    expect(created.view).toMatchObject({
      value: "like",
      counts: { like: 1, dislike: 0, total: 1 },
    });

    const updated = await upsertChatMessageFeedback({
      actor,
      sessionId,
      messageId,
      value: "dislike",
    });
    expect(updated.feedback.id).toBe(created.feedback.id);
    expect(updated.view).toMatchObject({
      value: "dislike",
      counts: { like: 0, dislike: 1, total: 1 },
    });
    expect(db.updates).toHaveLength(2);
    expect(db.updates[1]).toMatchObject({ value: "dislike", source: "web" });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for another user's message", async () => {
    const db = voteDb(null);
    mocks.getIamDb.mockReturnValue(db);

    const error = await upsertChatMessageFeedback({
      actor,
      sessionId,
      messageId: foreignMessageId,
      value: "like",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatFeedbackTargetNotFoundError);
    expect(error).toMatchObject({ status: 404 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects a user message", async () => {
    const db = voteDb(assistantMessage({ role: "user" }));
    mocks.getIamDb.mockReturnValue(db);

    await expect(
      upsertChatMessageFeedback({ actor, sessionId, messageId, value: "like" }),
    ).rejects.toBeInstanceOf(ChatFeedbackTargetNotFoundError);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each(["streaming", "failed"] as const)(
    "rejects a %s assistant message",
    async (status) => {
      const db = voteDb(assistantMessage({ status }));
      mocks.getIamDb.mockReturnValue(db);

      await expect(
        deleteChatMessageFeedback({ actor, sessionId, messageId }),
      ).rejects.toBeInstanceOf(ChatFeedbackTargetNotFoundError);
    },
  );

  it("rejects a requested message from another session before aggregate counts run", async () => {
    const db = queryDb([[{ id: sessionId }], [], []]);
    mocks.getIamDb.mockReturnValue(db);

    await expect(
      listChatMessageFeedback({
        actor,
        sessionId,
        messageIds: [foreignMessageId],
      }),
    ).rejects.toBeInstanceOf(ChatFeedbackTargetNotFoundError);
    expect(db.select).toHaveBeenCalledTimes(3);
  });
});
