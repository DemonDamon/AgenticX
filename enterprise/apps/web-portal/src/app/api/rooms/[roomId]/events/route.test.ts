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
    getRoom: vi.fn(),
    listMessages: vi.fn(),
  };
});

import { CollabRoomForbiddenError, getRoom, listMessages } from "../../../../../lib/collab-room";
import { getSessionFromCookies } from "../../../../../lib/session";
import { GET } from "./route";

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

async function readFrames(res: Response, minEvents: number): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  try {
    while ((acc.match(/^event:/gm) ?? []).length < minEvents) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value);
    }
  } finally {
    await reader.cancel();
  }
  return acc;
}

describe("GET /api/rooms/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMessages).mockReset();
    vi.mocked(getRoom).mockReset();
    vi.mocked(listMessages).mockResolvedValue([]);
  });

  it("returns 401 without session", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/events`), params());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-member before opening a stream", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockRejectedValueOnce(new CollabRoomForbiddenError());
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/events`), params());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
  });

  it("returns 400 for invalid room id", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await GET(new Request("http://localhost/api/rooms/nope/events"), {
      params: Promise.resolve({ roomId: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative after_seq", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await GET(
      new Request(`http://localhost/api/rooms/${ROOM}/events?after_seq=-1`),
      params(),
    );
    expect(res.status).toBe(400);
  });

  it("first frame is room_cursor with current last_seq", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockResolvedValueOnce({
      id: ROOM,
      tenant_id: session.tenantId,
      title: "房",
      created_by: session.userId,
      member_count: 1,
      last_seq: 5,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(listMessages).mockResolvedValue([]);
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/events`), params());
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = await readFrames(res, 1);
    expect(frames).toContain("event: room_cursor");
    expect(frames).toContain('"last_seq":5');
  });

  it("pushes only messages with seq greater than cursor", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockResolvedValueOnce({
      id: ROOM,
      tenant_id: session.tenantId,
      title: "房",
      created_by: session.userId,
      member_count: 1,
      last_seq: 4,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
        room_id: ROOM,
        tenant_id: session.tenantId,
        seq: 4,
        sender_type: "human",
        sender_id: session.userId,
        sender_name: "Alice",
        content: "hi",
        created_at: "2026-08-28T00:00:00.000Z",
      },
    ]);
    const res = await GET(
      new Request(`http://localhost/api/rooms/${ROOM}/events?after_seq=3`),
      params(),
    );
    const frames = await readFrames(res, 2);
    expect(listMessages).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      expect.objectContaining({ afterSeq: 3 }),
    );
    expect(frames).toContain("event: room_message");
    expect(frames).toContain('"seq":4');
  });

  it("emits room_closed gone when membership is revoked mid-stream", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockResolvedValueOnce({
      id: ROOM,
      tenant_id: session.tenantId,
      title: "房",
      created_by: session.userId,
      member_count: 1,
      last_seq: 0,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(listMessages).mockRejectedValue(new CollabRoomForbiddenError());
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/events`), params());
    const frames = await readFrames(res, 2);
    expect(frames).toContain("event: room_closed");
    expect(frames).toContain('"reason":"gone"');
  });

  it("does not claim revocation when the store fails for other reasons", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockResolvedValueOnce({
      id: ROOM,
      tenant_id: session.tenantId,
      title: "房",
      created_by: session.userId,
      member_count: 1,
      last_seq: 0,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(listMessages).mockRejectedValue(new Error("connection reset"));
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}/events`), params());
    const frames = await readFrames(res, 2);
    expect(frames).toContain("event: room_cursor");
    expect(frames).not.toContain('"reason":"gone"');
  });

  it("stops polling after client abort", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockResolvedValueOnce({
      id: ROOM,
      tenant_id: session.tenantId,
      title: "房",
      created_by: session.userId,
      member_count: 1,
      last_seq: 0,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    vi.mocked(listMessages).mockResolvedValue([]);
    const abort = new AbortController();
    const res = await GET(
      new Request(`http://localhost/api/rooms/${ROOM}/events`, { signal: abort.signal }),
      params(),
    );
    await readFrames(res, 1);
    abort.abort();
    const before = vi.mocked(listMessages).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(listMessages).mock.calls.length).toBe(before);
  });
});
