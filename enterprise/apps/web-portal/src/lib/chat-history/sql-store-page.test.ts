import { describe, expect, it, vi } from "vitest";
import { SqlChatHistoryStore, type SqlClient, type SqlDialect, type SqlResult } from "./sql-store";
import type { ChatSessionListCursor } from "./types";

type Fixture = {
  id: string;
  pinned_at: string | null;
  created_at: string;
  message_count: number;
  deleted_at?: string | null;
};

const FIXTURES: Fixture[] = [
  { id: "01J00000000000000000000001", pinned_at: "2026-09-21T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z", message_count: 1 },
  { id: "01J00000000000000000000003", pinned_at: "2026-09-20T00:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z", message_count: 1 },
  { id: "01J00000000000000000000004", pinned_at: "2026-09-20T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z", message_count: 1 },
  { id: "01J00000000000000000000002", pinned_at: null, created_at: "2026-09-02T00:00:00.000Z", message_count: 1 },
  { id: "01J00000000000000000000005", pinned_at: null, created_at: "2026-09-01T00:00:00.000Z", message_count: 1 },
  { id: "01J00000000000000000000006", pinned_at: null, created_at: "2026-09-03T00:00:00.000Z", message_count: 0 },
];

function compareSessions(a: Fixture, b: Fixture): number {
  const aPinned = a.pinned_at ? Date.parse(a.pinned_at) : 0;
  const bPinned = b.pinned_at ? Date.parse(b.pinned_at) : 0;
  if (aPinned !== bPinned) {
    if (aPinned === 0) return 1;
    if (bPinned === 0) return -1;
    return bPinned - aPinned;
  }
  const created = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (created !== 0) return created;
  return b.id.localeCompare(a.id);
}

function afterCursor(row: Fixture, cursor: { pinnedAt: number | null; createdAt: number; id: string }): boolean {
  const rowPinned = row.pinned_at ? Date.parse(row.pinned_at) : null;
  if (cursor.pinnedAt !== null) {
    if (rowPinned === null) return true;
    if (rowPinned < cursor.pinnedAt) return true;
    if (rowPinned > cursor.pinnedAt) return false;
  } else if (rowPinned !== null) {
    return false;
  }
  const rowCreated = Date.parse(row.created_at);
  if (rowCreated < cursor.createdAt) return true;
  if (rowCreated > cursor.createdAt) return false;
  return row.id < cursor.id;
}

function createPagingClient() {
  const query = vi.fn(async (statement: string, params: unknown[] = []): Promise<SqlResult> => {
    const limit = Number(params.at(-1));
    let items = FIXTURES.filter((row) => row.message_count > 0 && !row.deleted_at);
    if (params.length >= 8) {
      items = items.filter((row) => afterCursor(row, {
        pinnedAt: new Date(params[2] as Date).getTime(),
        createdAt: new Date(params[4] as Date).getTime(),
        id: String(params[6]),
      }));
    } else if (params.length >= 6) {
      items = items.filter((row) => afterCursor(row, {
        pinnedAt: null,
        createdAt: new Date(params[2] as Date).getTime(),
        id: String(params[4]),
      }));
    }
    items.sort(compareSessions);
    const rows = items.slice(0, limit).map((row) => ({
      id: row.id,
      tenant_id: "tenant-a",
      user_id: "user-a",
      title: row.id,
      message_count: row.message_count,
      pinned_at: row.pinned_at,
      created_at: row.created_at,
      updated_at: row.created_at,
      preview_text: null,
    }));
    return { rows, rowCount: rows.length };
  });
  const client: SqlClient = {
    query,
    async transaction<T>(callback: (tx: SqlClient) => Promise<T>): Promise<T> {
      return callback(client);
    },
    close: vi.fn(),
  };
  return { client, query };
}

describe.each(["postgresql", "mysql"] as const)("listChatSessionsPage (%s)", (dialect: SqlDialect) => {
  it("keeps pinned sessions first and pages without overlap or gaps", async () => {
    const { client, query } = createPagingClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const ctx = { tenantId: "tenant-a", userId: "user-a" };
    const seen: string[] = [];
    let cursor: ChatSessionListCursor | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await store.listChatSessionsPage(ctx, { limit: 2, cursor });
      for (const session of result.sessions) {
        expect(seen).not.toContain(session.id);
        seen.push(session.id);
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([
      "01J00000000000000000000001",
      "01J00000000000000000000003",
      "01J00000000000000000000004",
      "01J00000000000000000000002",
      "01J00000000000000000000005",
    ]);
    const firstSql = String(query.mock.calls[0]?.[0]);
    expect(firstSql).toContain("(s.pinned_at is null) asc");
    expect(firstSql).toContain("s.created_at desc, s.id desc");
    expect(firstSql).toContain("s.deleted_at is null and s.message_count > 0");
    expect(query.mock.calls[0]?.[1]).toEqual(["tenant-a", "user-a", 3]);
    const pinnedSql = String(query.mock.calls[1]?.[0]);
    const unpinnedSql = String(query.mock.calls[2]?.[0]);
    expect(pinnedSql).toContain("s.pinned_at is null or s.pinned_at <");
    expect(unpinnedSql).toContain("s.pinned_at is null and");
    expect(unpinnedSql).not.toContain("s.pinned_at is null or");
  });

  it("restarts at the first page when the cursor is illegal", async () => {
    const { client, query } = createPagingClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const page = await store.listChatSessionsPage(
      { tenantId: "tenant-a", userId: "user-a" },
      { limit: 2, cursor: { pinnedAt: "not-a-date", createdAt: "also-bad", id: "not-a-session-id" } },
    );
    expect(page.sessions.map((session) => session.id)).toEqual([
      "01J00000000000000000000001",
      "01J00000000000000000000003",
    ]);
    expect(String(query.mock.calls[0]?.[0])).not.toContain("s.pinned_at <");
    expect(query.mock.calls[0]?.[1]).toEqual(["tenant-a", "user-a", 3]);
  });
});
