import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/collab-room")>();
  return {
    ...actual,
    listRooms: vi.fn(),
    createRoom: vi.fn(),
  };
});

import { CollabRoomForbiddenError, createRoom, listRooms } from "../../../lib/collab-room";
import { getSessionFromCookies } from "../../../lib/session";
import { GET, POST } from "./route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

describe("GET /api/rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/rooms returns 401 without session", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "40101", message: "unauthorized" } });
  });

  it("GET /api/rooms maps Forbidden to 403", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(listRooms).mockRejectedValueOnce(new CollabRoomForbiddenError());
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "40301", message: "forbidden" } });
  });

  it("POST /api/rooms creates owner + meta members", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(createRoom).mockResolvedValueOnce({
      id: "01R00M0AAAAAAAAAAAAAAAAAAA",
      tenant_id: session.tenantId,
      title: "项目房",
      created_by: session.userId,
      member_count: 2,
      last_seq: 0,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    });
    const res = await POST(
      new Request("http://localhost/api/rooms", {
        method: "POST",
        body: JSON.stringify({ title: "项目房" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      { title: "项目房", displayName: "alice@example.com" },
    );
  });
});
