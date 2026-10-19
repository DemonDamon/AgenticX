import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    appendMessage: vi.fn(),
    findMessageByClientMsgId: vi.fn(async () => null),
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

import { appendMessage, findMessageByClientMsgId } from "../../../../../lib/collab-room";
import { triggerMetaReply } from "../../../../../lib/collab-room/meta-reply";
import { GET, POST } from "../[roomId]/messages/route";

const IDENTITY = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: null,
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};
const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

function params() {
  return { params: Promise.resolve({ roomId: ROOM }) };
}

function createdMessage(content: string) {
  return {
    id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
    room_id: ROOM,
    tenant_id: IDENTITY.tenantId,
    seq: 1,
    sender_type: "human" as const,
    sender_id: IDENTITY.userId,
    sender_name: IDENTITY.displayName,
    client_msg_id: null,
    content,
    created_at: "2026-08-28T00:00:00.000Z",
  };
}

describe("POST /api/desktop/rooms/:id/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
  });

  it("POST messages derives the sender from the PAT identity only", async () => {
    vi.mocked(appendMessage).mockResolvedValueOnce(createdMessage("hello"));
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: "hello",
          sender_id: "01EVILAAAAAAAAAAAAAAAAAAAA",
        }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(appendMessage).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      ROOM,
      expect.objectContaining({
        senderType: "human",
        senderId: IDENTITY.userId,
        senderName: "Bob",
        content: "hello",
      }),
    );
  });

  it("POST messages forwards a client_msg_id and returns the message", async () => {
    const created = createdMessage("hello");
    vi.mocked(appendMessage).mockResolvedValueOnce(created);
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "hello", client_msg_id: "client-1" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { message: { id: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.message.id).toBe(created.id);
    expect(appendMessage).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      ROOM,
      expect.objectContaining({ content: "hello", clientMsgId: "client-1" }),
    );
  });

  it("POST messages rejects a client_msg_id over 64 chars", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "hello", client_msg_id: "x".repeat(65) }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST messages rejects empty content", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "   " }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST messages rejects content over 8000 chars", async () => {
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "x".repeat(8001) }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST messages triggers a meta reply when @Meta is mentioned", async () => {
    vi.mocked(appendMessage).mockResolvedValueOnce(createdMessage("@Meta hi"));
    vi.mocked(triggerMetaReply).mockResolvedValueOnce(undefined);
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "@Meta hi" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(triggerMetaReply).toHaveBeenCalledTimes(1);
    const session = vi.mocked(triggerMetaReply).mock.calls[0][2];
    expect(session.sessionId).toMatch(/^desktop-pat-/);
    const overrides = vi.mocked(triggerMetaReply).mock.calls[0]?.[3];
    expect(typeof overrides?.getAccessToken).toBe("function");
  });

  it("POST messages returns the stored message for a repeated client_msg_id without asking Meta again", async () => {
    vi.mocked(findMessageByClientMsgId).mockResolvedValueOnce({
      ...createdMessage("@Meta hi"),
      client_msg_id: "retry-1",
    });
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "@Meta hi", client_msg_id: "retry-1" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: { client_msg_id: string } } };
    expect(body.data.message.client_msg_id).toBe("retry-1");
    expect(appendMessage).not.toHaveBeenCalled();
    expect(triggerMetaReply).not.toHaveBeenCalled();
  });

  it("POST messages does not trigger a meta reply without a mention", async () => {
    vi.mocked(appendMessage).mockResolvedValueOnce(createdMessage("plain"));
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "plain" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(triggerMetaReply).not.toHaveBeenCalled();
  });

  it("POST messages still returns 200 when the meta reply fails", async () => {
    const created = createdMessage("@Meta hi");
    vi.mocked(appendMessage).mockResolvedValueOnce(created);
    vi.mocked(triggerMetaReply).mockRejectedValueOnce(new Error("gateway down"));
    const res = await POST(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "@Meta hi" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: { id: string } } };
    expect(body.data.message.id).toBe(created.id);
  });

  it("GET messages rejects a negative after_seq", async () => {
    const res = await GET(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/messages?after_seq=-1`),
      params(),
    );
    expect(res.status).toBe(400);
  });
});
