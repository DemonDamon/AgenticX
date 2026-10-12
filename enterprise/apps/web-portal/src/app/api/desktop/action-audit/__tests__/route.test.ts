import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

const IDENTITY = {
  userId: "u1",
  tenantId: "t1",
  deptId: "d1",
  email: "a@example.invalid",
  displayName: "A",
  tokenId: 1,
  scopes: ["workspace:chat", "desktop:managed"],
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    event_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ts: "2026-10-12T08:00:00Z",
    kind: "confirm_resolved",
    session_id: "sess",
    agent_id: "meta",
    tool_name: "bash_exec",
    subject: "git:push",
    outcome: "approved",
    decision_source: "human",
    risk: "high",
    args_digest: "ab".repeat(32),
    summary: "push?",
    ...overrides,
  };
}

function post(body: unknown, authorization = "Bearer agx-pat-live") {
  return new Request("http://localhost/api/desktop/action-audit", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/action-audit", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_BASE_URL = "http://gateway.test";
  });

  it("returns 401 without a desktop identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "40101" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the PAT lacks desktop:managed", async () => {
    resolveDesktopIdentity.mockResolvedValue({ ...IDENTITY, scopes: ["workspace:chat"] });
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "40301" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty batch and a batch over 200", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../route");
    const empty = await POST(post({ events: [] }));
    expect(empty.status).toBe(400);
    const tooMany = await POST(post({ events: Array.from({ length: 201 }, () => event()) }));
    expect(tooMany.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad kind with the first failing index", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event(), event({ event_id: "b".repeat(32), kind: "nope" })] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ index: 1, message: expect.stringMatching(/kind/) });
  });

  it("rejects a bad event_id", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event({ event_id: "NOT-HEX" })] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.index).toBe(0);
    expect(json.message).toMatch(/event_id/);
  });

  it("passes through a gateway 502", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "gateway down" }), { status: 502 }));
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).not.toBe("50201");
    expect(json.message).toBe("gateway down");
  });

  it("forwards the original Authorization header", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    const { POST } = await import("../route");
    const res = await POST(post({ events: [event()] }, "Bearer agx-pat-original"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "00000", data: { accepted: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/desktop/action-audit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer agx-pat-original");
  });
});
