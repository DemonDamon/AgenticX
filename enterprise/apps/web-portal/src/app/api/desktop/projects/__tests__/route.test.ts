import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    addProjectMember: vi.fn(),
    openDirectRoom: vi.fn(),
  };
});

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    insertAuditEvent: vi.fn(async () => undefined),
  };
});

import { insertAuditEvent } from "@agenticx/iam-core";
import {
  addProjectMember,
  createProject,
  getProject,
  listProjects,
  openDirectRoom,
} from "../../../../../lib/collab-room";
import { GET as GET_ONE } from "../[projectId]/route";
import { POST as POST_DIRECT } from "../[projectId]/direct/route";
import { POST as POST_MEMBER } from "../[projectId]/members/route";
import { GET, POST } from "../route";

const IDENTITY = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: "01DEPT0AAAAAAAAAAAAAAAAAAA",
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};
const PROJECT = "01PR0JECTAAAAAAAAAAAAAAAAA";
const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const PEER = "01PEER0AAAAAAAAAAAAAAAAAAA";

function projectStub() {
  return {
    id: PROJECT,
    tenant_id: IDENTITY.tenantId,
    name: "阿尔法项目",
    instructions: null,
    owner_user_id: IDENTITY.userId,
    dept_id: IDENTITY.deptId,
    main_room_id: ROOM,
    settings: { connectors: [], experts: [], skills: [] },
    archived_at: null,
    member_count: 2,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
}

function roomStub() {
  return {
    id: ROOM,
    tenant_id: IDENTITY.tenantId,
    title: "单聊",
    created_by: IDENTITY.userId,
    project_id: PROJECT,
    parent_room_id: null,
    room_kind: "direct" as const,
    member_count: 2,
    last_seq: 0,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
}

describe("desktop project routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
  });

  it("GET /api/desktop/projects returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/desktop/projects"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "40101" });
  });

  it("POST /api/desktop/projects returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/desktop/projects", {
        method: "POST",
        body: JSON.stringify({ name: "阿尔法" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/desktop/projects rejects a name longer than 15 characters", async () => {
    const res = await POST(
      new Request("http://localhost/api/desktop/projects", {
        method: "POST",
        body: JSON.stringify({ name: "一二三四五六七八九十一二三四五六" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("POST /api/desktop/projects returns the created project", async () => {
    vi.mocked(createProject).mockResolvedValueOnce(projectStub());
    const res = await POST(
      new Request("http://localhost/api/desktop/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "  阿尔法项目  ",
          member_user_ids: [{ user_id: PEER, display_name: "Alice" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; message: string; data: { project: { id: string; name: string } } };
    expect(body).toMatchObject({
      code: "00000",
      message: "ok",
      data: { project: { id: PROJECT, name: "阿尔法项目" } },
    });
    expect(createProject).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      expect.objectContaining({
        name: "阿尔法项目",
        displayName: "Bob",
        deptId: IDENTITY.deptId,
        memberUserIds: [{ userId: PEER, displayName: "Alice" }],
      }),
    );
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.create", targetKind: "project", targetId: PROJECT }),
    );
  });

  it("GET /api/desktop/projects returns the project list", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([projectStub()]);
    const res = await GET(new Request("http://localhost/api/desktop/projects"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { projects: unknown[] } };
    expect(body.code).toBe("00000");
    expect(body.data.projects).toHaveLength(1);
  });

  it("GET /api/desktop/projects/:id returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await GET_ONE(new Request(`http://localhost/api/desktop/projects/${PROJECT}`), {
      params: Promise.resolve({ projectId: PROJECT }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/desktop/projects/:id returns the project and rooms", async () => {
    vi.mocked(getProject).mockResolvedValueOnce({ project: projectStub(), rooms: [roomStub()] });
    const res = await GET_ONE(new Request(`http://localhost/api/desktop/projects/${PROJECT}`), {
      params: Promise.resolve({ projectId: PROJECT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { project: { id: string }; rooms: unknown[] } };
    expect(body.code).toBe("00000");
    expect(body.data.project.id).toBe(PROJECT);
    expect(body.data.rooms).toHaveLength(1);
  });

  it("POST /api/desktop/projects/:id/members returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST_MEMBER(
      new Request(`http://localhost/api/desktop/projects/${PROJECT}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: PEER, display_name: "Alice" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/desktop/projects/:id/members returns the member", async () => {
    vi.mocked(addProjectMember).mockResolvedValueOnce({
      id: "01MEM0AAAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      member_type: "human",
      member_id: PEER,
      display_name: "Alice",
      room_role: "member",
      joined_at: "2026-10-19T00:00:00.000Z",
    });
    const res = await POST_MEMBER(
      new Request(`http://localhost/api/desktop/projects/${PROJECT}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: PEER, display_name: "Alice" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { member: { member_id: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.member.member_id).toBe(PEER);
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.member.add", targetKind: "project" }),
    );
  });

  it("POST /api/desktop/projects/:id/direct returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST_DIRECT(
      new Request(`http://localhost/api/desktop/projects/${PROJECT}/direct`, {
        method: "POST",
        body: JSON.stringify({ peer_user_id: PEER, peer_display_name: "Alice" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/desktop/projects/:id/direct returns the room", async () => {
    vi.mocked(openDirectRoom).mockResolvedValueOnce(roomStub());
    const res = await POST_DIRECT(
      new Request(`http://localhost/api/desktop/projects/${PROJECT}/direct`, {
        method: "POST",
        body: JSON.stringify({ peer_user_id: PEER, peer_display_name: "Alice" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { room: { id: string; room_kind: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.room.id).toBe(ROOM);
    expect(body.data.room.room_kind).toBe("direct");
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.room.direct_open", targetKind: "collab_room" }),
    );
  });
});
