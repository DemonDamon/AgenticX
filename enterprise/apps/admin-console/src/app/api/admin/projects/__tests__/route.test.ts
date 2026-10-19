import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSomeScopeMock = vi.fn();
const listAdminProjectsMock = vi.fn();
const getAdminProjectMock = vi.fn();
const listAdminProjectMessagesMock = vi.fn();
const getAdminUserMock = vi.fn();
const insertAuditEventMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminSomeScope: (...args: unknown[]) => requireAdminSomeScopeMock(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listAdminProjects: (...args: unknown[]) => listAdminProjectsMock(...args),
  getAdminProject: (...args: unknown[]) => getAdminProjectMock(...args),
  listAdminProjectMessages: (...args: unknown[]) => listAdminProjectMessagesMock(...args),
  getAdminUser: (...args: unknown[]) => getAdminUserMock(...args),
  insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
  ProjectForbiddenError: class ProjectForbiddenError extends Error {
    constructor(message = "forbidden") {
      super(message);
      this.name = "ProjectForbiddenError";
    }
  },
  ProjectNotFoundError: class ProjectNotFoundError extends Error {
    constructor(message = "not found") {
      super(message);
      this.name = "ProjectNotFoundError";
    }
  },
}));

import { ProjectForbiddenError } from "@agenticx/iam-core";
import { GET as GET_MESSAGES } from "../[id]/rooms/[roomId]/messages/route";
import { GET } from "../route";

const SCOPES = ["audit:read:all", "audit:read:dept", "audit:manage"];

describe("admin project routes", () => {
  beforeEach(() => {
    requireAdminSomeScopeMock.mockReset();
    listAdminProjectsMock.mockReset();
    getAdminProjectMock.mockReset();
    listAdminProjectMessagesMock.mockReset();
    getAdminUserMock.mockReset();
    insertAuditEventMock.mockReset();
    insertAuditEventMock.mockResolvedValue(undefined);
  });

  it("returns 403 when the caller lacks project read scope", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40300", message: "forbidden" }), { status: 403 }),
    });
    const response = await GET(new Request("http://localhost/api/admin/projects"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "40300" });
    expect(requireAdminSomeScopeMock).toHaveBeenCalledWith(SCOPES);
    expect(listAdminProjectsMock).not.toHaveBeenCalled();
  });

  it("passes dept visibility when the caller has audit:read:dept", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@example.com", userId: "user_1", tenantId: "tenant_1" },
      scopes: ["audit:read:dept"],
    });
    getAdminUserMock.mockResolvedValue({ deptId: "dept_9" });
    listAdminProjectsMock.mockResolvedValue({ items: [], total: 0 });
    const response = await GET(new Request("http://localhost/api/admin/projects?q=alpha&page=2&page_size=10"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "00000", message: "ok", data: { items: [], total: 0 } });
    expect(getAdminUserMock).toHaveBeenCalledWith("tenant_1", "user_1");
    expect(listAdminProjectsMock).toHaveBeenCalledWith(
      "tenant_1",
      { mode: "dept", deptId: "dept_9" },
      { q: "alpha", limit: 10, offset: 10 },
    );
  });

  it("writes project.room.view after a successful message read", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@example.com", userId: "user_1", tenantId: "tenant_1" },
      scopes: ["audit:read:dept"],
    });
    getAdminUserMock.mockResolvedValue({ deptId: "dept_9" });
    getAdminProjectMock.mockResolvedValue({
      project: { id: "p1" },
      rooms: [{ id: "room_1", room_kind: "main" }],
      members: [],
    });
    listAdminProjectMessagesMock.mockResolvedValue({
      messages: [{ seq: 1, sender_type: "human", sender_name: "Ada", content: "hi", metadata: null, created_at: "2026-10-19T00:00:00.000Z" }],
    });
    const response = await GET_MESSAGES(
      new Request("http://localhost/api/admin/projects/p1/rooms/room_1/messages?limit=20"),
      { params: Promise.resolve({ id: "p1", roomId: "room_1" }) },
    );
    expect(response.status).toBe(200);
    expect(listAdminProjectMessagesMock).toHaveBeenCalledWith(
      "tenant_1",
      "room_1",
      { mode: "dept", deptId: "dept_9" },
      { afterSeq: undefined, limit: 20 },
    );
    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    expect(insertAuditEventMock).toHaveBeenCalledWith({
      tenantId: "tenant_1",
      actorUserId: "user_1",
      eventType: "project.room.view",
      targetKind: "collab_room",
      targetId: "room_1",
    });
  });

  it("does not write an audit event when direct-room messages are forbidden", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@example.com", userId: "user_1", tenantId: "tenant_1" },
      scopes: ["audit:read:dept"],
    });
    getAdminUserMock.mockResolvedValue({ deptId: "dept_9" });
    getAdminProjectMock.mockResolvedValue({
      project: { id: "p1" },
      rooms: [{ id: "room_1", room_kind: "direct" }],
      members: [],
    });
    listAdminProjectMessagesMock.mockRejectedValue(new ProjectForbiddenError());
    const response = await GET_MESSAGES(
      new Request("http://localhost/api/admin/projects/p1/rooms/room_1/messages"),
      { params: Promise.resolve({ id: "p1", roomId: "room_1" }) },
    );
    expect(response.status).toBe(403);
    expect(insertAuditEventMock).not.toHaveBeenCalled();
  });
});
