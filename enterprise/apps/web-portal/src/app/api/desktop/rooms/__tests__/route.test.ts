import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    listRooms: vi.fn(),
    getRoom: vi.fn(),
    listMembers: vi.fn(),
  };
});

import { CollabRoomForbiddenError, getRoom, listMembers, listRooms } from "../../../../../lib/collab-room";
import { GET as GET_LIST } from "../route";
import { GET as GET_ROOM } from "../[roomId]/route";

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

function roomStub() {
  return {
    id: ROOM,
    tenant_id: IDENTITY.tenantId,
    title: "房",
    created_by: IDENTITY.userId,
    member_count: 1,
    last_seq: 5,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

describe("GET /api/desktop/rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/desktop/rooms returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await GET_LIST(new Request("http://localhost/api/desktop/rooms"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "40101" });
  });

  it("GET /api/desktop/rooms lists rooms for the PAT identity", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(IDENTITY);
    vi.mocked(listRooms).mockResolvedValueOnce([roomStub()]);
    const res = await GET_LIST(new Request("http://localhost/api/desktop/rooms"));
    expect(res.status).toBe(200);
    expect(listRooms).toHaveBeenCalledWith({
      tenantId: IDENTITY.tenantId,
      userId: IDENTITY.userId,
    });
  });

  it("GET /api/desktop/rooms/:id returns room, members and viewer id", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(IDENTITY);
    vi.mocked(getRoom).mockResolvedValueOnce(roomStub());
    vi.mocked(listMembers).mockResolvedValueOnce([
      {
        id: "01MEM0AAAAAAAAAAAAAAAAAAAA",
        room_id: ROOM,
        member_type: "human",
        member_id: IDENTITY.userId,
        display_name: "Bob",
        room_role: "member",
        joined_at: "2026-08-28T00:00:00.000Z",
      },
    ]);
    const res = await GET_ROOM(new Request(`http://localhost/api/desktop/rooms/${ROOM}`), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { room: unknown; members: unknown; viewer_user_id: string } };
    expect(body.data.room).toBeTruthy();
    expect(body.data.members).toHaveLength(1);
    expect(body.data.viewer_user_id).toBe(IDENTITY.userId);
    expect(getRoom).toHaveBeenCalledTimes(1);
    expect(listMembers).toHaveBeenCalledTimes(1);
  });

  it("GET /api/desktop/rooms/:id maps forbidden to 403", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(IDENTITY);
    vi.mocked(getRoom).mockRejectedValueOnce(new CollabRoomForbiddenError());
    const res = await GET_ROOM(new Request(`http://localhost/api/desktop/rooms/${ROOM}`), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/desktop/rooms/:id rejects a non-ulid room id", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(IDENTITY);
    const res = await GET_ROOM(new Request("http://localhost/api/desktop/rooms/nope"), {
      params: Promise.resolve({ roomId: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});
