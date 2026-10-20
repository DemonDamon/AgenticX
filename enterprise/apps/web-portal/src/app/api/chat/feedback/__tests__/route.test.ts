import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TargetNotFoundError extends Error {
    public readonly status = 404;
  }
  class ValidationError extends Error {}
  return {
    getSessionFromCookies: vi.fn(),
    upsertChatMessageFeedback: vi.fn(),
    deleteChatMessageFeedback: vi.fn(),
    listChatMessageFeedback: vi.fn(),
    TargetNotFoundError,
    ValidationError,
  };
});

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: mocks.getSessionFromCookies,
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));
vi.mock("../../../../../lib/chat-feedback", () => ({
  ChatFeedbackTargetNotFoundError: mocks.TargetNotFoundError,
  ChatFeedbackValidationError: mocks.ValidationError,
  upsertChatMessageFeedback: mocks.upsertChatMessageFeedback,
  deleteChatMessageFeedback: mocks.deleteChatMessageFeedback,
  listChatMessageFeedback: mocks.listChatMessageFeedback,
}));

import { DELETE, GET, PUT } from "../route";

const session = {
  userId: "01J00000000000000000000001",
  tenantId: "01J00000000000000000000002",
  deptId: "01J00000000000000000000003",
  email: "user@example.test",
  scopes: ["workspace:chat"],
  mustChangePassword: false,
  sessionId: "auth-session",
};

const view = {
  messageId: "01J00000000000000000000004",
  sessionId: "01J00000000000000000000005",
  value: "like" as const,
  counts: { like: 1, dislike: 0, total: 1 },
};

function request(method: string, body?: unknown, url = "http://localhost/api/chat/feedback") {
  return new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

describe("/api/chat/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionFromCookies.mockResolvedValue(session);
    mocks.upsertChatMessageFeedback.mockResolvedValue({
      feedback: { ...view, id: "01J00000000000000000000006" },
      view,
    });
    mocks.deleteChatMessageFeedback.mockResolvedValue({
      view: { ...view, value: null, counts: { like: 0, dislike: 0, total: 0 } },
    });
    mocks.listChatMessageFeedback.mockResolvedValue([view]);
  });

  it("returns 401 before touching the store when the caller is signed out", async () => {
    mocks.getSessionFromCookies.mockResolvedValue(null);
    const response = await PUT(request("PUT", {
      session_id: view.sessionId,
      message_id: view.messageId,
      value: "like",
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "40101", message: "unauthorized" },
    });
    expect(mocks.upsertChatMessageFeedback).not.toHaveBeenCalled();
  });

  it("returns the password-change response and does not write", async () => {
    mocks.getSessionFromCookies.mockResolvedValue({ ...session, mustChangePassword: true });
    const response = await PUT(request("PUT", {
      session_id: view.sessionId,
      message_id: view.messageId,
      value: "like",
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "40302",
      message: "password_change_required",
    });
    expect(mocks.upsertChatMessageFeedback).not.toHaveBeenCalled();
  });

  it("PUT DELETE and GET use the session actor and the success envelope", async () => {
    const put = await PUT(request("PUT", {
      tenant_id: "attacker-tenant",
      user_id: "attacker-user",
      session_id: view.sessionId,
      message_id: view.messageId,
      value: "like",
    }));
    expect(put.status).toBe(200);
    expect(mocks.upsertChatMessageFeedback).toHaveBeenCalledWith({
      actor: {
        tenantId: session.tenantId,
        userId: session.userId,
        departmentId: session.deptId,
      },
      sessionId: view.sessionId,
      messageId: view.messageId,
      value: "like",
    });
    await expect(put.json()).resolves.toMatchObject({
      code: "00000",
      message: "ok",
      data: { feedback: { message_id: view.messageId, value: "like" }, viewer_value: "like" },
    });

    const listed = await GET(request(
      "GET",
      undefined,
      `http://localhost/api/chat/feedback?session_id=${view.sessionId}`,
    ));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      code: "00000",
      message: "ok",
      data: { items: [{ message_id: view.messageId, value: "like" }] },
    });

    const cleared = await DELETE(request("DELETE", {
      session_id: view.sessionId,
      message_id: view.messageId,
    }));
    expect(cleared.status).toBe(200);
    expect(mocks.deleteChatMessageFeedback).toHaveBeenCalledWith({
      actor: {
        tenantId: session.tenantId,
        userId: session.userId,
        departmentId: session.deptId,
      },
      sessionId: view.sessionId,
      messageId: view.messageId,
    });
    await expect(cleared.json()).resolves.toMatchObject({
      code: "00000",
      message: "ok",
      data: { feedback: { message_id: view.messageId, value: null }, viewer_value: null },
    });
  });
});
