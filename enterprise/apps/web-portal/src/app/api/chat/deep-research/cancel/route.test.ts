import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  get: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("../../../../../lib/session", () => ({
  getSessionAuthFromCookies: mocks.auth,
  passwordChangeRequiredResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: { get: mocks.get, finish: mocks.finish },
}));
vi.mock("../../../../../lib/observability/with-request-log", () => ({
  withRequestLog: (_name: string, handler: (ctx: { setUser: () => void; setMode: () => void; setRun: () => void }) => Promise<Response>) =>
    handler({ setUser: vi.fn(), setMode: vi.fn(), setRun: vi.fn() }),
}));

import { POST } from "./route";

describe("POST /api/chat/deep-research/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      session: { tenantId: "t", userId: "u", mustChangePassword: false },
    });
    mocks.finish.mockImplementation(async () => {
      mocks.get.mockResolvedValue({ runId: "run-1", status: "cancelled" });
    });
    mocks.get.mockResolvedValue({ runId: "run-1", status: "running" });
  });

  it("cancels the current user's running research", async () => {
    const response = await POST(new Request("http://localhost/api/chat/deep-research/cancel", {
      method: "POST",
      body: JSON.stringify({ runId: "run-1" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.finish).toHaveBeenCalledWith("run-1", "cancelled");
    expect((await response.json()).data).toMatchObject({ runId: "run-1", status: "cancelled" });
  });

  it("does not cancel a run the caller cannot read", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/chat/deep-research/cancel", {
      method: "POST",
      body: JSON.stringify({ runId: "run-1" }),
    }));
    expect(response.status).toBe(404);
    expect(mocks.finish).not.toHaveBeenCalled();
  });
});
