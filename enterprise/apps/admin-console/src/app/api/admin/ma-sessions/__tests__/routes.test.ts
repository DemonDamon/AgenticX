import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listMaSessionsMock = vi.fn();
const getMaSessionMock = vi.fn();
const listMaSessionEventsMock = vi.fn();
const listMaWorkItemsMock = vi.fn();
const loadAuthUserByEmailMock = vi.fn();
const getAdminUserMock = vi.fn();
const listAgentsMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listMaSessions: (...args: unknown[]) => listMaSessionsMock(...args),
  getMaSession: (...args: unknown[]) => getMaSessionMock(...args),
  listMaSessionEvents: (...args: unknown[]) => listMaSessionEventsMock(...args),
  listMaWorkItems: (...args: unknown[]) => listMaWorkItemsMock(...args),
  loadAuthUserByEmail: (...args: unknown[]) => loadAuthUserByEmailMock(...args),
  getAdminUser: (...args: unknown[]) => getAdminUserMock(...args),
  listAgents: (...args: unknown[]) => listAgentsMock(...args),
}));

const SESSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SESSION_ID_2 = "01ARZ3NDEKTSV4RRFFQ69G5FB0";

type ListGet = (request: Request) => Promise<Response>;
type DetailGet = (request: Request, context: { params: Promise<{ sessionId: string }> }) => Promise<Response>;

let listGET: ListGet;
let detailGET: DetailGet;
let eventsGET: DetailGet;

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    title: "协作房间",
    agentId: "A1",
    agentVersion: 2,
    environmentId: "local",
    createdByUserId: "U1",
    source: "portal",
    status: "idle",
    stopReason: { type: "end_turn", event_ids: [] },
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 0,
      tool_calls: 2,
      runtime_ms: 8400,
    },
    lastSeq: 17,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:09.000Z",
    vaultIds: ["vault-1"],
    resources: [{ kind: "file" }],
    ...overrides,
  };
}

describe("admin ma-sessions routes", () => {
  beforeAll(async () => {
    listGET = (await import("../route")).GET;
    detailGET = (await import("../[sessionId]/route")).GET;
    eventsGET = (await import("../[sessionId]/events/route")).GET;
  });

  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listMaSessionsMock.mockReset();
    getMaSessionMock.mockReset();
    listMaSessionEventsMock.mockReset();
    listMaWorkItemsMock.mockReset();
    loadAuthUserByEmailMock.mockReset();
    getAdminUserMock.mockReset();
    listAgentsMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "t1", userId: "admin", email: "admin@example.com" },
      scopes: ["audit:read:all"],
    });
    listMaSessionsMock.mockResolvedValue({ items: [], nextBeforeId: null });
    getMaSessionMock.mockResolvedValue(null);
    listMaSessionEventsMock.mockResolvedValue({ items: [], nextAfterSeq: null });
    listMaWorkItemsMock.mockResolvedValue([]);
    loadAuthUserByEmailMock.mockResolvedValue(null);
    getAdminUserMock.mockResolvedValue(null);
    listAgentsMock.mockResolvedValue([]);
  });

  it("list requires audit:read:all", async () => {
    const response = new Response(JSON.stringify({ code: "40300", message: "forbidden" }), { status: 403 });
    requireAdminScopeMock.mockResolvedValue({ ok: false, response });
    const result = await listGET(new Request("http://localhost/api/admin/ma-sessions"));
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["audit:read:all"]);
    expect(result).toBe(response);
    expect(listMaSessionsMock).not.toHaveBeenCalled();
  });

  it("list uses the admin session tenant and range", async () => {
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions"));
    expect(response.status).toBe(200);
    expect(listMaSessionsMock).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ limit: 50, createdFrom: expect.any(String) }),
    );
  });

  it("resolves user_email to a user id", async () => {
    loadAuthUserByEmailMock.mockResolvedValue({ id: "U1", email: "alice@example.com" });
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions?user_email=Alice@Example.com"));
    expect(response.status).toBe(200);
    expect(loadAuthUserByEmailMock).toHaveBeenCalledWith("t1", "alice@example.com");
    expect(listMaSessionsMock).toHaveBeenCalledWith("t1", expect.objectContaining({ userId: "U1" }));
  });

  it("returns empty list for unknown email", async () => {
    loadAuthUserByEmailMock.mockResolvedValue(null);
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions?user_email=missing@example.com"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { items: [], nextBeforeId: null } });
    expect(listMaSessionsMock).not.toHaveBeenCalled();
  });

  it("enriches agent and user names", async () => {
    listMaSessionsMock.mockResolvedValue({
      items: [
        sessionRow({ id: SESSION_ID, createdByUserId: "U1", agentId: "A1" }),
        sessionRow({ id: SESSION_ID_2, createdByUserId: "U2", agentId: "A1" }),
        sessionRow({ id: SESSION_ID, createdByUserId: "U1", agentId: "A1" }),
      ],
      nextBeforeId: null,
    });
    listAgentsMock.mockResolvedValue([{ id: "A1", displayName: "报告助手", slug: "r" }]);
    getAdminUserMock.mockImplementation(async (_tenant: string, id: string) => {
      if (id === "U1") return { email: "a@x.com", displayName: "Alice" };
      throw new Error("missing");
    });
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions"));
    const body = (await response.json()) as {
      data: { items: Array<{ agentName: string | null; user: { id: string; email: string; displayName: string } | null }> };
    };
    expect(body.data.items[0]?.agentName).toBe("报告助手");
    expect(body.data.items[0]?.user?.displayName).toBe("Alice");
    expect(body.data.items[1]?.user).toEqual({ id: "U2", email: "", displayName: "" });
    const ids = getAdminUserMock.mock.calls.map((call) => call[1]);
    expect(ids.filter((id) => id === "U1")).toHaveLength(1);
    expect(ids.filter((id) => id === "U2")).toHaveLength(1);
  });

  it("rejects invalid filters with 400", async () => {
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions?status=paused"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "40000", message: "状态参数不合法" });
  });

  it("detail returns 404 for unknown or malformed ids", async () => {
    getMaSessionMock.mockResolvedValue(null);
    const unknown = await detailGET(new Request(`http://localhost/api/admin/ma-sessions/${SESSION_ID}`), {
      params: Promise.resolve({ sessionId: SESSION_ID }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "40400", message: "会话不存在" });

    getMaSessionMock.mockClear();
    const malformed = await detailGET(new Request("http://localhost/api/admin/ma-sessions/x"), {
      params: Promise.resolve({ sessionId: "x" }),
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ message: "会话不存在" });
    expect(getMaSessionMock).not.toHaveBeenCalled();
  });

  it("detail returns session and work items", async () => {
    getMaSessionMock.mockResolvedValue(sessionRow());
    listMaWorkItemsMock.mockResolvedValue([{ id: "w1", status: "completed" }]);
    const response = await detailGET(new Request(`http://localhost/api/admin/ma-sessions/${SESSION_ID}`), {
      params: Promise.resolve({ sessionId: SESSION_ID }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { session: { id: string; vaultIds: string[]; resources: unknown[] }; workItems: unknown[] };
    };
    expect(body.data.session.id).toBe(SESSION_ID);
    expect(body.data.session.vaultIds).toEqual(["vault-1"]);
    expect(body.data.session.resources).toEqual([{ kind: "file" }]);
    expect(body.data.workItems).toEqual([{ id: "w1", status: "completed" }]);
  });

  it("events forwards after_seq and limit", async () => {
    getMaSessionMock.mockResolvedValue(sessionRow());
    const response = await eventsGET(
      new Request(`http://localhost/api/admin/ma-sessions/${SESSION_ID}/events?after_seq=17&limit=500`),
      { params: Promise.resolve({ sessionId: SESSION_ID }) },
    );
    expect(response.status).toBe(200);
    expect(listMaSessionEventsMock).toHaveBeenCalledWith("t1", SESSION_ID, { afterSeq: 17, limit: 500 });
  });

  it("events rejects negative after_seq", async () => {
    const response = await eventsGET(
      new Request(`http://localhost/api/admin/ma-sessions/${SESSION_ID}/events?after_seq=-1`),
      { params: Promise.resolve({ sessionId: SESSION_ID }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "40000", message: "分页参数不合法" });
  });

  it("maps missing tables to 503", async () => {
    listMaSessionsMock.mockRejectedValue(new Error('relation "ma_sessions" does not exist'));
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "50301" });
  });

  it("hides internal error details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listMaSessionsMock.mockRejectedValue(new Error("boom secret"));
    const response = await listGET(new Request("http://localhost/api/admin/ma-sessions"));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toMatchObject({ code: "50001", message: "internal error" });
    errorSpy.mockRestore();
  });
});
