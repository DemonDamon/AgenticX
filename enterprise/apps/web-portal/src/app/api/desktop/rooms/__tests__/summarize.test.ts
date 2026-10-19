import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const getRoom = vi.fn();
const listMessages = vi.fn();
const appendMessage = vi.fn();
const listAvailableModelsForUser = vi.fn();
const getSessionAuthFromCookies = vi.fn();
const requestMetaReply = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    getRoom: (...args: unknown[]) => getRoom(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
    appendMessage: (...args: unknown[]) => appendMessage(...args),
  };
});

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: (...args: unknown[]) => listAvailableModelsForUser(...args),
}));

vi.mock("../../../../../lib/session", () => ({
  getSessionAuthFromCookies: (...args: unknown[]) => getSessionAuthFromCookies(...args),
}));

vi.mock("../../../../../lib/collab-room/meta-reply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room/meta-reply")>();
  return {
    ...actual,
    requestMetaReply: (...args: unknown[]) => requestMetaReply(...args),
  };
});

import { CollabRoomForbiddenError } from "../../../../../lib/collab-room";
import { POST } from "../[roomId]/summarize/route";

const IDENTITY = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: "01DEPT0AAAAAAAAAAAAAAAAAAA",
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};
const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const MSG_A = "01MSG0AAAAAAAAAAAAAAAAAAAA";
const MSG_B = "01MSG1AAAAAAAAAAAAAAAAAAAA";
const MSG_MISSING = "01MSG9AAAAAAAAAAAAAAAAAAAA";

function params(roomId = ROOM) {
  return { params: Promise.resolve({ roomId }) };
}

function roomStub() {
  return {
    id: ROOM,
    tenant_id: IDENTITY.tenantId,
    title: "小群",
    created_by: IDENTITY.userId,
    project_id: "01PR0JECTAAAAAAAAAAAAAAAAA",
    parent_room_id: "01MAIN0AAAAAAAAAAAAAAAAAAA",
    room_kind: "sub" as const,
    member_count: 2,
    last_seq: 4,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
}

function message(id: string, seq: number, content: string, senderName: string) {
  return {
    id,
    room_id: ROOM,
    tenant_id: IDENTITY.tenantId,
    seq,
    sender_type: "human" as const,
    sender_id: IDENTITY.userId,
    sender_name: senderName,
    content,
    client_msg_id: null,
    created_at: "2026-10-19T00:00:00.000Z",
  };
}

const MODEL = {
  id: "demo/model",
  provider: "demo",
  providerLabel: "Demo",
  model: "model",
  label: "model",
  route: "third-party" as const,
  isDefault: true,
};

describe("POST /api/desktop/rooms/:id/summarize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    getRoom.mockResolvedValue(roomStub());
    listMessages.mockResolvedValue([
      message(MSG_A, 1, "hello", "Alice"),
      message(MSG_B, 2, "ship it", "Bob"),
    ]);
    listAvailableModelsForUser.mockResolvedValue([MODEL]);
    getSessionAuthFromCookies.mockResolvedValue({
      accessToken: "tok",
      refreshToken: null,
      session: {
        userId: IDENTITY.userId,
        tenantId: IDENTITY.tenantId,
        email: IDENTITY.email,
        scopes: IDENTITY.scopes,
        sessionId: "sess",
        mustChangePassword: false,
      },
    });
    requestMetaReply.mockResolvedValue("结论：已对齐\n决定：合并\n待办：Alice 跟进");
  });

  it("returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST(new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, { method: "POST" }), params());
    expect(res.status).toBe(401);
    expect(getRoom).not.toHaveBeenCalled();
  });

  it("rejects an invalid room id", async () => {
    const res = await POST(
      new Request("http://localhost/api/desktop/rooms/nope/summarize", { method: "POST", body: "{}" }),
      params("nope"),
    );
    expect(res.status).toBe(400);
    expect(getRoom).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an active member", async () => {
    getRoom.mockRejectedValueOnce(new CollabRoomForbiddenError());
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, { method: "POST", body: "{}" }),
      params(),
    );
    expect(res.status).toBe(403);
    expect(requestMetaReply).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("returns a summary draft and does not write a room message", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, { method: "POST", body: "{}" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: "00000",
      message: "ok",
      data: { summary: "结论：已对齐\n决定：合并\n待办：Alice 跟进" },
    });
    expect(listMessages).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      ROOM,
      { afterSeq: 0, limit: 200 },
    );
    expect(requestMetaReply).toHaveBeenCalledWith(
      [
        {
          role: "system",
          content: "把下面的群聊整理成：结论、决定、待办（含负责人）三部分，简洁、不编造",
        },
        { role: "user", content: "Alice：hello\nBob：ship it" },
      ],
      expect.objectContaining({
        model: "model",
        headers: expect.objectContaining({
          authorization: "Bearer tok",
          "x-tenant-id": IDENTITY.tenantId,
          "x-agenticx-provider": "demo",
          "x-agenticx-trace-stage": "room.summary",
        }),
      }),
    );
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("summarizes only the requested messages", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, {
        method: "POST",
        body: JSON.stringify({ message_ids: [MSG_B] }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const prompt = requestMetaReply.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(prompt[1]?.content).toBe("Bob：ship it");
    expect(prompt[1]?.content).not.toContain("hello");
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when a requested message is not in the room", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, {
        method: "POST",
        body: JSON.stringify({ message_ids: [MSG_MISSING] }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(requestMetaReply).not.toHaveBeenCalled();
  });

  it("returns 503 when no model is available and writes nothing", async () => {
    listAvailableModelsForUser.mockResolvedValueOnce([]);
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, { method: "POST", body: "{}" }),
      params(),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "50301", message: "智能体暂时不可用" } });
    expect(requestMetaReply).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("returns 503 when the model call fails and writes nothing", async () => {
    requestMetaReply.mockRejectedValueOnce(new Error("gateway down"));
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/summarize`, { method: "POST", body: "{}" }),
      params(),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "50301", message: "智能体暂时不可用" } });
    expect(appendMessage).not.toHaveBeenCalled();
  });
});
