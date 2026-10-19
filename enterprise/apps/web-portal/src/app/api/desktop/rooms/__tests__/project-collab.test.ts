import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    createSubRoom: vi.fn(),
    mergeBack: vi.fn(),
    approveMerge: vi.fn(),
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
import { approveMerge, createSubRoom, mergeBack } from "../../../../../lib/collab-room";
import { POST as POST_APPROVE } from "../[roomId]/merge/[seq]/approve/route";
import { POST as POST_MERGE } from "../[roomId]/merge/route";
import { POST as POST_SUB } from "../[roomId]/sub-rooms/route";

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
const TARGET = "01TARGET0AAAAAAAAAAAAAAAAA";
const PEER = "01PEER0AAAAAAAAAAAAAAAAAAA";

function roomStub() {
  return {
    id: "01SUBR00M0AAAAAAAAAAAAAAAA",
    tenant_id: IDENTITY.tenantId,
    title: "小群",
    created_by: IDENTITY.userId,
    project_id: "01PR0JECTAAAAAAAAAAAAAAAAA",
    parent_room_id: ROOM,
    room_kind: "sub" as const,
    member_count: 2,
    last_seq: 0,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
}

function messageStub() {
  return {
    id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
    room_id: TARGET,
    tenant_id: IDENTITY.tenantId,
    seq: 3,
    sender_type: "system" as const,
    sender_id: IDENTITY.userId,
    sender_name: "Bob",
    content: "【合回自「小群」，共 1 条】\nBob：hi",
    metadata: { kind: "merge_back" },
    client_msg_id: null,
    created_at: "2026-10-19T00:00:00.000Z",
  };
}

describe("desktop project room routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
  });

  it("POST sub-rooms returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST_SUB(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/sub-rooms`, {
        method: "POST",
        body: JSON.stringify({ title: "小群", member_user_ids: [] }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST sub-rooms returns the new room", async () => {
    vi.mocked(createSubRoom).mockResolvedValueOnce(roomStub());
    const res = await POST_SUB(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/sub-rooms`, {
        method: "POST",
        body: JSON.stringify({
          title: "小群",
          member_user_ids: [{ user_id: PEER, display_name: "Alice" }],
        }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { room: { room_kind: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.room.room_kind).toBe("sub");
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.room.sub_create", targetKind: "collab_room" }),
    );
  });

  it("POST merge returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST_MERGE(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_room_id: TARGET, mode: "all" }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST merge returns the merged message", async () => {
    vi.mocked(mergeBack).mockResolvedValueOnce({ pending: false, message: messageStub() });
    const res = await POST_MERGE(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_room_id: TARGET, mode: "all" }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { message: { metadata: { kind: string } } } };
    expect(body.code).toBe("00000");
    expect(body.data.message.metadata.kind).toBe("merge_back");
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.merge_back", targetKind: "collab_room" }),
    );
  });

  it("POST merge approve returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await POST_APPROVE(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/merge/2/approve`, { method: "POST" }),
      { params: Promise.resolve({ roomId: ROOM, seq: "2" }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST merge approve returns the message", async () => {
    vi.mocked(approveMerge).mockResolvedValueOnce(messageStub());
    const res = await POST_APPROVE(
      new Request(`http://localhost/api/desktop/rooms/${ROOM}/merge/2/approve`, { method: "POST" }),
      { params: Promise.resolve({ roomId: ROOM, seq: "2" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; data: { message: { id: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.message.id).toBe(messageStub().id);
    expect(approveMerge).toHaveBeenCalledWith(
      { tenantId: IDENTITY.tenantId, userId: IDENTITY.userId },
      ROOM,
      2,
    );
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "project.merge_approve", targetKind: "collab_room" }),
    );
  });
});
