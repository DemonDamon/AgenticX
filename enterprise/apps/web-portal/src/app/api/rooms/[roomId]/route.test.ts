import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/collab-room")>();
  return {
    ...actual,
    getRoom: vi.fn(),
    listMembers: vi.fn(),
  };
});

import { CollabRoomNotFoundError, getRoom } from "../../../../lib/collab-room";
import { getSessionFromCookies } from "../../../../lib/session";
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

describe("GET /api/rooms/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/rooms/:id maps NotFound to 404", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getRoom).mockRejectedValueOnce(new CollabRoomNotFoundError());
    const res = await GET(new Request(`http://localhost/api/rooms/${ROOM}`), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "40401", message: "not found" } });
  });
});
