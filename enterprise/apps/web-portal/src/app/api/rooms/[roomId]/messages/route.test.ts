import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    appendMessage: vi.fn(),
    listMessages: vi.fn(),
  };
});

vi.mock("../../../../../lib/collab-room/meta-reply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room/meta-reply")>();
  return {
    ...actual,
    triggerMetaReply: vi.fn(),
  };
});

import { appendMessage, listMessages } from "../../../../../lib/collab-room";
import { triggerMetaReply } from "../../../../../lib/collab-room/meta-reply";
import { getSessionFromCookies } from "../../../../../lib/session";
import { GET, POST } from "./route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

function params() {
  return { params: Promise.resolve({ roomId: ROOM }) };
}

describe("POST /api/rooms/:id/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/rooms/:id/messages rejects client-supplied sender", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(appendMessage).mockResolvedValueOnce({
      id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      tenant_id: session.tenantId,
      seq: 1,
      sender_type: "human",
      sender_id: session.userId,
      sender_name: session.email,
      content: "hello",
      created_at: "2026-08-28T00:00:00.000Z",
    });
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "hello", sender_id: "someone-else" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(appendMessage).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      expect.objectContaining({
        senderType: "human",
        senderId: session.userId,
        senderName: "alice@example.com",
        content: "hello",
      }),
    );
  });

  it("POST /api/rooms/:id/messages rejects empty content", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "   " }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST /api/rooms/:id/messages rejects invalid room id", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await POST(
      new Request("http://localhost/api/rooms/not-a-ulid/messages", {
        method: "POST",
        body: JSON.stringify({ content: "hello" }),
      }),
      { params: Promise.resolve({ roomId: "not-a-ulid" }) },
    );
    expect(res.status).toBe(400);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("GET messages passes after_seq through to the store", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(listMessages).mockResolvedValueOnce([]);
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/messages?after_seq=7`), params());
    expect(res.status).toBe(200);
    expect(listMessages).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      expect.objectContaining({ afterSeq: 7 }),
    );
  });

  it("POST messages still returns 200 when meta reply fails", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(appendMessage).mockResolvedValueOnce({
      id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      tenant_id: session.tenantId,
      seq: 1,
      sender_type: "human",
      sender_id: session.userId,
      sender_name: session.email,
      content: "@Meta 帮我看下",
      created_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(triggerMetaReply).mockRejectedValueOnce(new Error("gateway down"));
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "@Meta 帮我看下" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: { content: string } } };
    expect(body.data.message.content).toBe("@Meta 帮我看下");
    expect(triggerMetaReply).toHaveBeenCalledTimes(1);
  });

  it("GET messages rejects negative after_seq", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await GET(
      new Request(`http://localhost/api/rooms/${ROOM}/messages?after_seq=-1`),
      params(),
    );
    expect(res.status).toBe(400);
    expect(listMessages).not.toHaveBeenCalled();
  });
});
