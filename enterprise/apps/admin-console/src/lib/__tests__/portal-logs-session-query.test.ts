import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDatabaseConfigMock = vi.fn();
const getIamDbMock = vi.fn();
const getAdminMysqlDbMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  resolveDatabaseConfig: (...args: unknown[]) => resolveDatabaseConfigMock(...args),
  getIamDb: (...args: unknown[]) => getIamDbMock(...args),
}));

vi.mock("../db-stores/mysql/database", () => ({
  getAdminMysqlDb: (...args: unknown[]) => getAdminMysqlDbMock(...args),
}));

type CapturedSelect = {
  whereArgs: unknown[];
  groupByCalled: boolean;
};

function createSelectChain(result: unknown[], capture: CapturedSelect) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn((...args: unknown[]) => {
    capture.whereArgs.push(args[0]);
    return chain;
  });
  chain.groupBy = vi.fn(() => {
    capture.groupByCalled = true;
    return chain;
  });
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.offset = vi.fn(async () => result);
  // count queries end at .where()
  Object.defineProperty(chain, "then", {
    value: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  });
  return chain;
}

describe("queryPortalLogSessions", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveDatabaseConfigMock.mockReset();
    getIamDbMock.mockReset();
    getAdminMysqlDbMock.mockReset();
  });

  it("applies a 7-day start window when start/end are omitted", async () => {
    const before = Date.now() - 7 * 864e5;
    const capture: CapturedSelect = { whereArgs: [], groupByCalled: false };
    const select = vi.fn(() => createSelectChain([{ value: 0 }], capture));
    // three selects: total, ungrouped, rows
    select
      .mockImplementationOnce(() => createSelectChain([{ value: 1 }], capture))
      .mockImplementationOnce(() => createSelectChain([{ value: 0 }], capture))
      .mockImplementationOnce(() =>
        createSelectChain(
          [
            {
              sessionId: "sess-1",
              turns: 2,
              firstTime: new Date("2026-08-10T00:00:00.000Z"),
              lastTime: new Date("2026-08-11T00:00:00.000Z"),
              totalDurationMs: 100,
              errorCount: 0,
              modes: "chat",
              userId: "u1",
            },
          ],
          capture,
        ),
      );

    resolveDatabaseConfigMock.mockReturnValue({ dialect: "postgresql" });
    getIamDbMock.mockReturnValue({ select });

    const { queryPortalLogSessions, DEFAULT_SESSION_WINDOW_DAYS } = await import(
      "../portal-logs-session-query"
    );
    expect(DEFAULT_SESSION_WINDOW_DAYS).toBe(7);

    const result = await queryPortalLogSessions({
      tenant_id: "t1",
      limit: 100,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.session_id).toBe("sess-1");
    expect(capture.groupByCalled).toBe(true);
    // gte(logTime, start) is present in the SQL condition tree; start ≈ now-7d
    const after = Date.now() - 7 * 864e5;
    expect(before).toBeLessThanOrEqual(after + 5_000);
    expect(capture.whereArgs.length).toBeGreaterThanOrEqual(3);
  });

  it("parses modes CSV into a unique string array", async () => {
    const { parseModesCsv } = await import("../portal-logs-session-query");
    expect(parseModesCsv("chat,web_search")).toEqual(["chat", "web_search"]);
    expect(parseModesCsv("chat,chat,web_search")).toEqual(["chat", "web_search"]);
    expect(parseModesCsv(null)).toEqual([]);
  });

  it("keeps session_id NULL rows out of items and in ungrouped_count", async () => {
    const capture: CapturedSelect = { whereArgs: [], groupByCalled: false };
    const select = vi.fn();
    select
      .mockImplementationOnce(() => createSelectChain([{ value: 1 }], capture))
      .mockImplementationOnce(() => createSelectChain([{ value: 3 }], capture))
      .mockImplementationOnce(() =>
        createSelectChain(
          [
            {
              sessionId: "sess-ok",
              turns: 1,
              firstTime: new Date("2026-08-11T00:00:00.000Z"),
              lastTime: new Date("2026-08-11T00:00:00.000Z"),
              totalDurationMs: 10,
              errorCount: 0,
              modes: "chat,web_search",
              userId: "u1",
            },
            {
              sessionId: null,
              turns: 1,
              firstTime: new Date("2026-08-11T00:00:00.000Z"),
              lastTime: new Date("2026-08-11T00:00:00.000Z"),
              totalDurationMs: 1,
              errorCount: 0,
              modes: "chat",
              userId: null,
            },
          ],
          capture,
        ),
      );

    resolveDatabaseConfigMock.mockReturnValue({ dialect: "postgresql" });
    getIamDbMock.mockReturnValue({ select });

    const { queryPortalLogSessions } = await import("../portal-logs-session-query");
    const result = await queryPortalLogSessions({
      tenant_id: "t1",
      limit: 100,
      offset: 0,
      start: "2026-08-01T00:00:00.000Z",
    });

    expect(result.ungrouped_count).toBe(3);
    expect(result.items.map((i) => i.session_id)).toEqual(["sess-ok"]);
    expect(result.items[0]?.modes).toEqual(["chat", "web_search"]);
  });

  it("forwards mode=deep_research into the query path without throwing", async () => {
    const capture: CapturedSelect = { whereArgs: [], groupByCalled: false };
    const select = vi.fn();
    select
      .mockImplementationOnce(() => createSelectChain([{ value: 0 }], capture))
      .mockImplementationOnce(() => createSelectChain([{ value: 0 }], capture))
      .mockImplementationOnce(() => createSelectChain([], capture));

    resolveDatabaseConfigMock.mockReturnValue({ dialect: "postgresql" });
    getIamDbMock.mockReturnValue({ select });

    const { queryPortalLogSessions } = await import("../portal-logs-session-query");
    const result = await queryPortalLogSessions({
      tenant_id: "t1",
      mode: "deep_research",
      limit: 50,
      offset: 0,
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-08-11T00:00:00.000Z",
    });

    expect(result).toEqual({ total: 0, items: [], ungrouped_count: 0 });
    expect(select).toHaveBeenCalledTimes(3);
    expect(capture.whereArgs.length).toBe(3);
  });
});
