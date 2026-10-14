import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const insertDesktopAgentTraces = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/desktop-agent-traces", () => ({
  insertDesktopAgentTraces: (...args: unknown[]) => insertDesktopAgentTraces(...args),
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

function span(overrides: Record<string, unknown> = {}) {
  return {
    trace_id: "near:sess.1:run_1",
    step_no: 1,
    step_kind: "model",
    status: "ok",
    input_tokens: 3,
    output_tokens: 4,
    reasoning_tokens: 1,
    total_tokens: 7,
    duration_ms: 12,
    model: "gpt-test",
    provider: "openai",
    metadata: { user_id: "other", source: "evil", round: 1 },
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/desktop/agent-traces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/agent-traces", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    insertDesktopAgentTraces.mockReset();
  });

  it("returns 401 without a desktop token", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(post({ spans: [span()] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "40101" });
    expect(insertDesktopAgentTraces).not.toHaveBeenCalled();
  });

  it("returns 400 for an illegal trace_id", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../route");
    const res = await POST(post({ spans: [span({ trace_id: "not-a-near-trace" })] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.index).toBe(0);
    expect(json.message).toMatch(/trace_id/);
    expect(insertDesktopAgentTraces).not.toHaveBeenCalled();
  });

  it("returns 400 when the batch exceeds 200 spans", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../route");
    const res = await POST(post({ spans: Array.from({ length: 201 }, () => span()) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "40001",
      message: expect.stringMatching(/1 to 200/),
    });
    expect(insertDesktopAgentTraces).not.toHaveBeenCalled();
  });

  it("overwrites metadata user_id and source before insert", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    insertDesktopAgentTraces.mockImplementation(async (input: { spans: unknown[] }) => input.spans.length);
    const { POST } = await import("../route");
    const res = await POST(post({ spans: [span(), span({ step_no: 2, step_kind: "run", metadata: {} })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "00000", data: { accepted: 2 } });
    expect(insertDesktopAgentTraces).toHaveBeenCalledTimes(1);
    const call = insertDesktopAgentTraces.mock.calls[0];
    expect(call).toBeDefined();
    const arg = call?.[0] as {
      tenantId: string;
      userId: string;
      spans: Array<{ metadata: Record<string, unknown> }>;
    };
    const first = arg.spans[0];
    const second = arg.spans[1];
    expect(arg.tenantId).toBe("t1");
    expect(arg.userId).toBe("u1");
    expect(first?.metadata).toMatchObject({
      user_id: "u1",
      source: "near",
      round: 1,
    });
    expect(second?.metadata).toEqual({ user_id: "u1", source: "near" });
  });
});
