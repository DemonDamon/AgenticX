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
    listProjects: vi.fn(),
    getProject: vi.fn(),
  };
});

import { getProject, listProjects } from "../../../../lib/collab-room";
import { getSessionFromCookies } from "../../../../lib/session";
import { GET as GET_ONE } from "../[projectId]/route";
import { GET } from "../route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const PROJECT = "01PR0JECTAAAAAAAAAAAAAAAAA";

describe("portal project routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/projects returns 401 without a session", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "40101", message: "unauthorized" } });
  });

  it("GET /api/projects lists the caller projects", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(listProjects).mockResolvedValueOnce([
      {
        id: PROJECT,
        tenant_id: session.tenantId,
        name: "阿尔法",
        instructions: null,
        owner_user_id: session.userId,
        dept_id: null,
        main_room_id: "01R00M0AAAAAAAAAAAAAAAAAAA",
        settings: { connectors: [], experts: [], skills: [] },
        archived_at: null,
        member_count: 2,
        created_at: "2026-10-19T00:00:00.000Z",
        updated_at: "2026-10-19T00:00:00.000Z",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { projects: Array<{ id: string }> } };
    expect(body.code).toBe("00000");
    expect(body.data.projects.map((item) => item.id)).toEqual([PROJECT]);
    expect(listProjects).toHaveBeenCalledWith({ tenantId: session.tenantId, userId: session.userId });
  });

  it("GET /api/projects/:id rejects an invalid id", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    const res = await GET_ONE(new Request("http://localhost/api/projects/nope"), {
      params: Promise.resolve({ projectId: "nope" }),
    });
    expect(res.status).toBe(400);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("GET /api/projects/:id returns the visible project and rooms", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(session);
    vi.mocked(getProject).mockResolvedValueOnce({
      project: {
        id: PROJECT,
        tenant_id: session.tenantId,
        name: "阿尔法",
        instructions: null,
        owner_user_id: session.userId,
        dept_id: null,
        main_room_id: "01R00M0AAAAAAAAAAAAAAAAAAA",
        settings: { connectors: [], experts: [], skills: [] },
        archived_at: null,
        member_count: 2,
        created_at: "2026-10-19T00:00:00.000Z",
        updated_at: "2026-10-19T00:00:00.000Z",
      },
      rooms: [],
    });
    const res = await GET_ONE(new Request(`http://localhost/api/projects/${PROJECT}`), {
      params: Promise.resolve({ projectId: PROJECT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { project: { name: string }; rooms: unknown[] } };
    expect(body).toMatchObject({
      code: "00000",
      message: "ok",
      data: { project: { name: "阿尔法" }, rooms: [] },
    });
  });
});
