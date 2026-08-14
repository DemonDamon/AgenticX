import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const resolveClarification = vi.fn();
const notifyClarifyResume = vi.fn();

vi.mock("../../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: {
    resolveClarification: (...args: unknown[]) => resolveClarification(...args),
  },
}));

vi.mock("../../../../../../lib/deep-research/run-wait", () => ({
  notifyClarifyResume: (...args: unknown[]) => notifyClarifyResume(...args),
}));

import { POST } from "../route";

const SESSION = { tenantId: "tenant-1", userId: "user-1", mustChangePassword: false };

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat/deep-research/resume", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/chat/deep-research/resume", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    resolveClarification.mockReset();
    notifyClarifyResume.mockReset();
    getSessionFromCookies.mockResolvedValue(SESSION);
    resolveClarification.mockResolvedValue("resumed");
  });

  it("stores the first answer and wakes local waiters", async () => {
    const response = await POST(
      request({ runId: "run-1", answers: { q1: " A " }, skip: false }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { runId: "run-1", resumed: true },
    });
    expect(resolveClarification).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      payload: { answers: { q1: "A" }, skip: false },
    });
    expect(notifyClarifyResume).toHaveBeenCalledWith("run-1");
  });

  it("treats an empty answer set as an explicit skip", async () => {
    await POST(request({ runId: "run-1", answers: {} }));
    expect(resolveClarification).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { answers: {}, skip: true } }),
    );
  });

  it("is idempotent for repeat submissions and timeouts", async () => {
    resolveClarification.mockResolvedValue("already_continued");
    const response = await POST(request({ runId: "run-1", answers: { q1: "A" } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { runId: "run-1", resumed: false, alreadyContinued: true },
    });
    expect(notifyClarifyResume).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown, cross-tenant and cross-user runs", async () => {
    resolveClarification.mockResolvedValue("not_found");
    const response = await POST(request({ runId: "someone-elses-run", answers: { q1: "A" } }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "40401" },
    });
  });

  it("returns 500 rather than faking already-continued when storage fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveClarification.mockRejectedValue(new Error("db down"));

    const response = await POST(request({ runId: "run-1", answers: { q1: "A" } }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "50000" } });
    expect(notifyClarifyResume).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects unauthenticated callers before touching the store", async () => {
    getSessionFromCookies.mockResolvedValue(null);
    const response = await POST(request({ runId: "run-1" }));
    expect(response.status).toBe(401);
    expect(resolveClarification).not.toHaveBeenCalled();
  });

  it("rejects a missing runId", async () => {
    const response = await POST(request({ answers: { q1: "A" } }));
    expect(response.status).toBe(400);
    expect(resolveClarification).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await POST(request("not json"));
    expect(response.status).toBe(400);
    expect(resolveClarification).not.toHaveBeenCalled();
  });
});
