import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeSessionListCursor,
  encodeSessionListCursor,
} from "../../../../lib/chat-history/session-list-cursor";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  list: vi.fn(),
  listPage: vi.fn(),
}));

vi.mock("../../../../lib/session", () => ({
  getSessionFromCookies: mocks.getSession,
  passwordChangeRequiredResponse: vi.fn(),
}));
vi.mock("../../../../lib/chat-history", () => ({
  listChatSessions: mocks.list,
  listChatSessionsPage: mocks.listPage,
  createChatSession: vi.fn(),
}));

import { GET } from "./route";

const identity = { tenantId: "tenant-a", userId: "user-a" };
const cursor = {
  pinnedAt: null,
  createdAt: "2026-09-19T10:00:00.000Z",
  id: "01J00000000000000000000001",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(identity);
  mocks.listPage.mockResolvedValue({ sessions: [], nextCursor: null });
});

describe("GET /api/chat/sessions pagination", () => {
  it("returns a bounded page and next_cursor", async () => {
    mocks.listPage.mockResolvedValue({ sessions: [{ id: cursor.id }], nextCursor: cursor });
    const response = await GET(new Request("http://localhost/api/chat/sessions?limit=40"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.sessions).toEqual([{ id: cursor.id }]);
    expect(body.data.next_cursor).toEqual(encodeSessionListCursor(cursor));
    expect(decodeSessionListCursor(body.data.next_cursor)).toEqual(cursor);
    expect(mocks.listPage).toHaveBeenCalledWith(identity, { limit: 40, cursor: null });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("pages with the default size when only a cursor is present", async () => {
    const encoded = encodeSessionListCursor(cursor);
    const response = await GET(new Request(
      `http://localhost/api/chat/sessions?cursor=${encoded}`,
    ));
    expect(response.status).toBe(200);
    expect(mocks.listPage).toHaveBeenCalledWith(identity, { limit: 40, cursor });
  });

  it("rejects malformed cursors and oversized pages", async () => {
    for (const search of ["?limit=101", "?limit=0", "?limit=40&cursor=bad", "?cursor=bad"]) {
      const response = await GET(new Request(`http://localhost/api/chat/sessions${search}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.listPage).not.toHaveBeenCalled();
  });

  it("keeps the unpaged response shape when no paging params are present", async () => {
    mocks.list.mockResolvedValue([{ id: cursor.id }]);
    const response = await GET(new Request("http://localhost/api/chat/sessions"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ sessions: [{ id: cursor.id }] });
    expect(body.data).not.toHaveProperty("next_cursor");
    expect(mocks.list).toHaveBeenCalledWith(identity);
    expect(mocks.listPage).not.toHaveBeenCalled();
  });
});
