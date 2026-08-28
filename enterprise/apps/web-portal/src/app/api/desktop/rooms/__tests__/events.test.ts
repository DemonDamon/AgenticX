import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
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
import { GET } from "../[roomId]/events/route";

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

function roomStub(lastSeq = 0) {
  return {
    id: ROOM,
    tenant_id: IDENTITY.tenantId,
    title: "房",
    created_by: IDENTITY.userId,
    member_count: 1,
    last_seq: lastSeq,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
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

describe("GET /api/desktop/rooms/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMessages).mockReset();
    vi.mocked(getRoom).mockReset();
    vi.mocked(listMessages).mockResolvedValue([]);
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
  });

  it("events returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockReset();
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`), params());
    expect(res.status).toBe(401);
  });

  it("events returns 403 for a non-member before opening a stream", async () => {
    vi.mocked(getRoom).mockRejectedValueOnce(new CollabRoomForbiddenError());
    const res = await GET(new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`), params());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
  });

  it("events first frame is room_cursor", async () => {
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub(5));
    const res = await GET(new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`), params());
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = await readFrames(res, 1);
    expect(frames).toContain("event: room_cursor");
    expect(frames).toContain('"last_seq":5');
  });

  it("events pushes messages after the cursor", async () => {
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub(4));
    vi.mocked(listMessages).mockResolvedValue([
      {
        id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
        room_id: ROOM,
        tenant_id: IDENTITY.tenantId,
        seq: 4,
        sender_type: "human",
        sender_id: IDENTITY.userId,
        sender_name: "Bob",
        content: "hi",
        created_at: "2026-08-28T00:00:00.000Z",
      },
    ]);
    const res = await GET(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/events?after_seq=3`),
      params(),
    );
    const frames = await readFrames(res, 2);
    expect(listMessages).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      ROOM,
      expect.objectContaining({ afterSeq: 3 }),
    );
    expect(frames).toContain("event: room_message");
    expect(frames).toContain('"seq":4');
  });

  it("events emits room_closed gone when membership is revoked", async () => {
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub(0));
    vi.mocked(listMessages).mockRejectedValue(new CollabRoomForbiddenError());
    const res = await GET(new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`), params());
    const frames = await readFrames(res, 2);
    expect(frames).toContain("event: room_closed");
    expect(frames).toContain('"reason":"gone"');
  });

  it("events does not claim revocation for other store failures", async () => {
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub(0));
    vi.mocked(listMessages).mockRejectedValue(new Error("connection reset"));
    const res = await GET(new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`), params());
    const frames = await readFrames(res, 2);
    expect(frames).toContain("event: room_cursor");
    expect(frames).not.toContain('"reason":"gone"');
  });

  it("events stops polling after client abort", async () => {
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub(0));
    vi.mocked(listMessages).mockResolvedValue([]);
    const abort = new AbortController();
    const res = await GET(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/events`, { signal: abort.signal }),
      params(),
    );
    await readFrames(res, 1);
    abort.abort();
    const before = vi.mocked(listMessages).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(listMessages).mock.calls.length).toBe(before);
  });
});
