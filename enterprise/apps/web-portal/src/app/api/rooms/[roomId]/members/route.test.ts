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
    addHumanMember: vi.fn(),
    listMembers: vi.fn(),
  };
});

import { addHumanMember } from "../../../../../lib/collab-room";
import { getSessionFromCookies } from "../../../../../lib/session";
import { POST } from "./route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "admin@agenticx.local",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

function params() {
  return { params: Promise.resolve({ roomId: ROOM }) };
}

describe("POST /api/rooms/:id/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionFromCookies).mockResolvedValue(session);
  });

  it("accepts a login email that is not a ULID", async () => {
    vi.mocked(addHumanMember).mockResolvedValueOnce({
      id: "01MEMBERAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      member_type: "human",
      member_id: "user_alice2_agenticx_local",
      display_name: "alice2",
      room_role: "member",
      joined_at: "2026-08-28T00:00:00.000Z",
    });
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "alice2@agenticx.local" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(addHumanMember).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      expect.objectContaining({ userId: "alice2@agenticx.local" }),
    );
  });

  it("rejects an empty user_id", async () => {
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "   " }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(addHumanMember).not.toHaveBeenCalled();
  });
});
