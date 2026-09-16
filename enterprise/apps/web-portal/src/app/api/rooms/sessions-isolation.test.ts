import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../lib/chat-history", () => ({
  listChatSessions: vi.fn(),
  createChatSession: vi.fn(),
}));

import { GET } from "../chat/sessions/route";
import { listChatSessions } from "../../../lib/chat-history";
import { getSessionFromCookies } from "../../../lib/session";

describe("personal chat sessions stay isolated from rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/chat/sessions does not include room data", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce({
      userId: "01USERAAAAAAAAAAAAAAAAAAAA",
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      email: "alice@example.com",
      scopes: [],
      sessionId: "sess-1",
      mustChangePassword: false,
    });
    vi.mocked(listChatSessions).mockResolvedValueOnce([
      {
        id: "01SESSAAAAAAAAAAAAAAAAAAAA",
        tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
        user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
        title: "个人助手",
        message_count: 0,
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.sessions).toHaveLength(1);
    expect(body.data).not.toHaveProperty("rooms");
  });
});
