import { describe, expect, it } from "vitest";
import type { SqlClient, SqlResult } from "../chat-history/sql-store";
import { SqlCollabRoomStore } from "./sql-store";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
} from "./types";

type Call = { sql: string; params: unknown[]; inTransaction: boolean };

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createFakeClient(
  respond: (sql: string, params: unknown[], call: Call) => SqlResult,
): SqlClient & { calls: Call[]; transactionCount: number } {
  const calls: Call[] = [];
  let inTransaction = false;
  let transactionCount = 0;

  const client: SqlClient & { calls: Call[]; transactionCount: number } = {
    calls,
    get transactionCount() {
      return transactionCount;
    },
    async query(statement, params = []): Promise<SqlResult> {
      const call: Call = { sql: statement, params, inTransaction };
      calls.push(call);
      return respond(normalize(statement), params, call);
    },
    async transaction(callback) {
      transactionCount += 1;
      inTransaction = true;
      try {
        return await callback(client);
      } finally {
        inTransaction = false;
      }
    },
    close() {},
  };
  return client;
}

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const OTHER_TENANT = "01TENANTBBBBBBBBBBBBBBBBBB";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01USERBBBBBBBBBBBBBBBBBBBB";
const ROOM = "01ROOMAAAAAAAAAAAAAAAAAAAA";

const ctx = { tenantId: TENANT, userId: USER };

const roomRow = {
  id: ROOM,
  tenant_id: TENANT,
  title: "项目房",
  created_by: USER,
  archived_at: null,
  member_count: 1,
  last_seq: 0,
  last_message_at: null,
  created_at: new Date("2026-08-28T00:00:00.000Z"),
  updated_at: new Date("2026-08-28T00:00:00.000Z"),
};

const memberRow = {
  id: "01MEMBERAAAAAAAAAAAAAAAAAA",
  room_id: ROOM,
  tenant_id: TENANT,
  member_type: "human",
  member_id: USER,
  display_name: "Alice",
  room_role: "owner",
  joined_at: new Date("2026-08-28T00:00:00.000Z"),
  left_at: null,
};

function authThen(sql: string, extra: (sql: string) => SqlResult): SqlResult {
  if (sql.includes("select id from enterprise_collab_rooms")) {
    return { rows: [{ id: ROOM }], rowCount: 1 };
  }
  if (
    sql.includes("from enterprise_collab_room_members") &&
    sql.includes("member_type = 'human'") &&
    sql.includes("left_at is null") &&
    sql.includes("limit 1")
  ) {
    return { rows: [memberRow], rowCount: 1 };
  }
  return extra(sql);
}

describe("SqlCollabRoomStore", () => {
  it("listRooms only returns rooms where caller is an active member", async () => {
    const client = createFakeClient((sql, params) => {
      if (sql.includes("join enterprise_collab_room_members")) {
        expect(sql).toContain("left_at is null");
        expect(sql).toContain("member_id");
        expect(params).toEqual([TENANT, USER]);
        return { rows: [roomRow], rowCount: 1 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    const rooms = await store.listRooms(ctx);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.id).toBe(ROOM);
    expect(normalize(client.calls[0]?.sql ?? "")).toContain("left_at is null");
    expect(client.calls[0]?.params[1]).toBe(USER);
  });

  it("getRoom throws Forbidden for non-member of an existing room", async () => {
    const client = createFakeClient((sql) => {
      if (sql.includes("select id from enterprise_collab_rooms")) {
        return { rows: [{ id: ROOM }], rowCount: 1 };
      }
      if (sql.includes("from enterprise_collab_room_members")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(store.getRoom(ctx, ROOM)).rejects.toBeInstanceOf(CollabRoomForbiddenError);
  });

  it("getRoom throws NotFound for unknown room id", async () => {
    const client = createFakeClient((sql) => {
      if (sql.includes("select id from enterprise_collab_rooms")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(store.getRoom(ctx, ROOM)).rejects.toBeInstanceOf(CollabRoomNotFoundError);
  });

  it("getRoom throws NotFound when room belongs to another tenant", async () => {
    const client = createFakeClient((sql, params) => {
      if (sql.includes("select id from enterprise_collab_rooms")) {
        expect(params).toEqual([ROOM, TENANT]);
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(store.getRoom({ tenantId: TENANT, userId: USER }, ROOM)).rejects.toBeInstanceOf(
      CollabRoomNotFoundError,
    );
    void OTHER_TENANT;
  });

  it("listMessages requires membership before querying messages", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.includes("from enterprise_collab_room_messages")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.listMessages(ctx, ROOM);
    const kinds = client.calls.map((call) => normalize(call.sql));
    const memberIdx = kinds.findIndex((sql) => sql.includes("from enterprise_collab_room_members"));
    const messageIdx = kinds.findIndex((sql) => sql.includes("from enterprise_collab_room_messages"));
    expect(memberIdx).toBeGreaterThanOrEqual(0);
    expect(messageIdx).toBeGreaterThan(memberIdx);
  });

  it("appendMessage assigns max(seq)+1 inside a transaction", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.includes("coalesce(max(seq)")) {
          return { rows: [{ max_seq: 3 }], rowCount: 1 };
        }
        if (inner.startsWith("insert into enterprise_collab_room_messages")) {
          return { rows: [], rowCount: 1 };
        }
        if (inner.startsWith("update enterprise_collab_rooms")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    const message = await store.appendMessage(ctx, ROOM, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "hello",
    });
    expect(message.seq).toBe(4);
    expect(client.transactionCount).toBe(1);
    const insert = client.calls.find((call) =>
      normalize(call.sql).startsWith("insert into enterprise_collab_room_messages"),
    );
    expect(insert?.inTransaction).toBe(true);
    expect(insert?.params[3]).toBe(4);
  });

  it("appendMessage retries once on unique violation", async () => {
    let inserts = 0;
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.includes("coalesce(max(seq)")) {
          return { rows: [{ max_seq: inserts }], rowCount: 1 };
        }
        if (inner.startsWith("insert into enterprise_collab_room_messages")) {
          inserts += 1;
          if (inserts === 1) {
            throw Object.assign(new Error("duplicate"), { code: "23505" });
          }
          return { rows: [], rowCount: 1 };
        }
        if (inner.startsWith("update enterprise_collab_rooms")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.appendMessage(ctx, ROOM, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "hello",
    });
    expect(inserts).toBe(2);
    expect(client.transactionCount).toBe(2);
  });

  it("appendMessage rejects empty content", async () => {
    const client = createFakeClient(() => {
      throw new Error("should not query");
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(
      store.appendMessage(ctx, ROOM, {
        senderType: "human",
        senderId: USER,
        senderName: "Alice",
        content: "   ",
      }),
    ).rejects.toBeInstanceOf(CollabRoomBadRequestError);
    expect(client.calls).toHaveLength(0);
  });

  it("leaveRoom issues an update to left_at and never a delete", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.startsWith("update enterprise_collab_room_members") && inner.includes("left_at")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.leaveRoom(ctx, ROOM);
    const sqls = client.calls.map((call) => normalize(call.sql));
    expect(sqls.some((sql) => sql.startsWith("update") && sql.includes("left_at"))).toBe(true);
    expect(sqls.some((sql) => sql.includes("delete from"))).toBe(false);
  });

  it("removeMember never deletes the member row", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.startsWith("update enterprise_collab_room_members") && inner.includes("left_at")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.removeMember(ctx, ROOM, OTHER);
    const sqls = client.calls.map((call) => normalize(call.sql));
    expect(sqls.some((sql) => sql.startsWith("update") && sql.includes("left_at"))).toBe(true);
    expect(sqls.some((sql) => sql.includes("delete from"))).toBe(false);
  });

  it("addHumanMember rejects a user from another tenant", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.includes("from users")) {
          return { rows: [{ id: OTHER, tenant_id: OTHER_TENANT }], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(
      store.addHumanMember(ctx, ROOM, { userId: OTHER, displayName: "Bob" }),
    ).rejects.toBeInstanceOf(CollabRoomBadRequestError);
  });

  it("addHumanMember resolves a tenant email to the real user id", async () => {
    const inserted: unknown[][] = [];
    const client = createFakeClient((sql, params) =>
      authThen(sql, (inner) => {
        if (inner.includes("from users")) {
          return {
            rows: [
              {
                id: OTHER,
                tenant_id: TENANT,
                email: "alice2@agenticx.local",
                display_name: "alice2",
              },
            ],
            rowCount: 1,
          };
        }
        if (inner.includes("from enterprise_collab_room_members") && inner.includes("member_id")) {
          return { rows: [], rowCount: 0 };
        }
        if (inner.startsWith("insert into enterprise_collab_room_members")) {
          inserted.push(params);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    const member = await store.addHumanMember(ctx, ROOM, {
      userId: "alice2@agenticx.local",
      displayName: "alice2@agenticx.local",
    });
    expect(member.member_id).toBe(OTHER);
    expect(member.display_name).toBe("alice2");
    expect(inserted[0]?.[4]).toBe(OTHER);
  });

  it("addHumanMember rejects an unknown email", async () => {
    const client = createFakeClient((sql) =>
      authThen(sql, (inner) => {
        if (inner.includes("from users")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await expect(
      store.addHumanMember(ctx, ROOM, { userId: "nobody@agenticx.local", displayName: "x" }),
    ).rejects.toBeInstanceOf(CollabRoomBadRequestError);
  });

  it("createRoom inserts owner and meta members", async () => {
    const memberTypes: string[] = [];
    const client = createFakeClient((sql, params) => {
      if (sql.startsWith("insert into enterprise_collab_rooms")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("insert into enterprise_collab_room_members")) {
        memberTypes.push(String(params[3]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("from enterprise_collab_rooms r") && sql.includes("member_count")) {
        return { rows: [{ ...roomRow, member_count: 2 }], rowCount: 1 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.createRoom(ctx, { title: "项目房", displayName: "Alice" });
    expect(memberTypes).toEqual(["human", "meta"]);
  });

  it("listMessages afterSeq filters by seq greater than cursor", async () => {
    const client = createFakeClient((sql, params) =>
      authThen(sql, (inner) => {
        if (inner.includes("from enterprise_collab_room_messages") && inner.includes("seq >")) {
          expect(params[2]).toBe(7);
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`unhandled sql: ${inner}`);
      }),
    );
    const store = new SqlCollabRoomStore("postgresql", client);
    await store.listMessages(ctx, ROOM, { afterSeq: 7 });
    const messageCall = client.calls.find((call) => normalize(call.sql).includes("seq >"));
    expect(messageCall).toBeTruthy();
    expect(normalize(messageCall?.sql ?? "")).toContain("seq >");
    expect(messageCall?.params[2]).toBe(7);
  });

  it("appendAgentMessageAsSystem writes an agent message without a membership check", async () => {
    const client = createFakeClient((sql) => {
      if (sql.includes("select id from enterprise_collab_rooms")) {
        return { rows: [{ id: ROOM }], rowCount: 1 };
      }
      if (sql.includes("coalesce(max(seq)")) {
        return { rows: [{ max_seq: 2 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into enterprise_collab_room_messages")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update enterprise_collab_rooms")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unhandled sql: ${sql}`);
    });
    const store = new SqlCollabRoomStore("postgresql", client);
    const message = await store.appendAgentMessageAsSystem(TENANT, ROOM, {
      senderType: "agent",
      senderId: "01AGENT0AAAAAAAAAAAAAAAA",
      senderName: "桌面助手",
      content: "桌面已执行完成",
      metadata: { runtime: "desktop_worker" },
    });
    expect(message.sender_type).toBe("agent");
    expect(message.seq).toBe(3);
    expect(client.calls.some((call) => normalize(call.sql).includes("enterprise_collab_room_members"))).toBe(false);
    const insert = client.calls.find((call) =>
      normalize(call.sql).startsWith("insert into enterprise_collab_room_messages"),
    );
    expect(insert?.params[4]).toBe("agent");
    expect(insert?.inTransaction).toBe(true);
  });
});

type Row = Record<string, unknown>;

function createMemoryClient(): SqlClient & { memory: { rooms: Row[]; messages: Row[] } } {
  const projects: Row[] = [];
  const rooms: Row[] = [];
  const members: Row[] = [];
  const messages: Row[] = [];
  const users = [
    { id: USER, tenant_id: TENANT },
    { id: OTHER, tenant_id: TENANT },
  ];

  function roomView(row: Row): Row {
    const roomMessages = messages.filter((item) => item.room_id === row.id);
    const seqs = roomMessages.map((item) => Number(item.seq));
    return {
      ...row,
      member_count: members.filter((item) => item.room_id === row.id && item.left_at == null).length,
      last_seq: seqs.length ? Math.max(...seqs) : 0,
      last_message_at: roomMessages.at(-1)?.created_at ?? null,
    };
  }

  function insert(table: string, cols: string[], params: unknown[]) {
    const row: Row = {};
    cols.forEach((col, index) => {
      row[col] = params[index];
    });
    if (table === "enterprise_projects") projects.push(row);
    else if (table === "enterprise_collab_rooms") rooms.push(row);
    else if (table === "enterprise_collab_room_members") members.push(row);
    else if (table === "enterprise_collab_room_messages") messages.push(row);
    else throw new Error(`insert ${table}`);
  }

  const client: SqlClient & { memory: { rooms: Row[]; messages: Row[] } } = {
    memory: { rooms, messages },
    async query(statement, params = []) {
      const sql = normalize(statement);
      const insertMatch = sql.match(/^insert into ([a-z0-9_]+) \(([^)]+)\) values/);
      if (insertMatch?.[1] && insertMatch[2]) {
        insert(
          insertMatch[1],
          insertMatch[2].split(",").map((col) => col.trim()),
          params,
        );
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update enterprise_projects")) {
        const row = projects.find((item) => item.id === params[2] && item.tenant_id === params[3]);
        if (row) {
          row.main_room_id = params[0];
          row.updated_at = params[1];
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("update enterprise_collab_rooms")) {
        const row = rooms.find((item) => item.id === params[1]);
        if (row) row.updated_at = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update enterprise_collab_room_messages")) {
        const row = messages.find((item) => item.room_id === params[2] && Number(item.seq) === Number(params[3]));
        if (row) {
          row.metadata = params[0];
          row.updated_at = params[1];
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("from users")) {
        const row = users.find((item) => item.tenant_id === params[0] && item.id === params[1]);
        return row ? { rows: [{ id: row.id, tenant_id: row.tenant_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("from enterprise_projects")) {
        if (sql.includes("select id, main_room_id")) {
          const row = projects.find((item) => item.id === params[0] && item.tenant_id === params[1]);
          return row ? { rows: [{ id: row.id, main_room_id: row.main_room_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("where p.id =")) {
          const row = projects.find((item) => item.id === params[0] && item.tenant_id === params[1]);
          if (!row) return { rows: [], rowCount: 0 };
          return {
            rows: [
              {
                ...row,
                member_count: members.filter((item) => item.room_id === row.main_room_id && item.left_at == null).length,
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`unhandled project sql: ${sql}`);
      }
      if (sql.includes("from enterprise_collab_rooms")) {
        if (sql.includes("room_kind = 'direct'") && sql.includes("exists")) {
          const [tenantId, projectId, userId, peerId] = params;
          const room = rooms.find(
            (item) =>
              item.tenant_id === tenantId &&
              item.project_id === projectId &&
              item.room_kind === "direct" &&
              members.some(
                (member) =>
                  member.room_id === item.id &&
                  member.member_type === "human" &&
                  member.member_id === userId &&
                  member.left_at == null,
              ) &&
              members.some(
                (member) =>
                  member.room_id === item.id &&
                  member.member_type === "human" &&
                  member.member_id === peerId &&
                  member.left_at == null,
              ),
          );
          return room ? { rows: [{ id: room.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("where r.id =")) {
          const room = rooms.find((item) => item.id === params[0] && item.tenant_id === params[1]);
          return room ? { rows: [roomView(room)], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("project_id, title, room_kind")) {
          const room = rooms.find((item) => item.id === params[0] && item.tenant_id === params[1]);
          return room ? { rows: [room], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("select id from enterprise_collab_rooms")) {
          const room = rooms.find((item) => item.id === params[0] && item.tenant_id === params[1]);
          return room ? { rows: [{ id: room.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        throw new Error(`unhandled room sql: ${sql}`);
      }
      if (sql.includes("from enterprise_collab_room_messages")) {
        if (sql.includes("coalesce(max(seq)")) {
          const seqs = messages.filter((item) => item.room_id === params[0]).map((item) => Number(item.seq));
          return { rows: [{ max_seq: seqs.length ? Math.max(...seqs) : 0 }], rowCount: 1 };
        }
        if (sql.includes("client_msg_id =")) {
          const row = messages.find((item) => item.room_id === params[0] && item.client_msg_id === params[1]);
          return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("where id =")) {
          const row = messages.find((item) => item.id === params[0]);
          return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        let rows = messages.filter((item) => item.room_id === params[0]);
        if (sql.includes("tenant_id =")) rows = rows.filter((item) => item.tenant_id === params[1]);
        if (sql.includes("and seq =")) {
          rows = rows.filter((item) => Number(item.seq) === Number(params[params.length - 1]));
        }
        if (sql.includes("id in")) {
          const ids = params.slice(2);
          rows = rows.filter((item) => ids.includes(item.id));
        }
        rows = rows.slice().sort((a, b) => Number(a.seq) - Number(b.seq));
        if (sql.includes("limit 1")) rows = rows.slice(0, 1);
        else if (sql.includes(" limit ")) {
          const limit = Number(params[params.length - 1]);
          if (Number.isFinite(limit)) rows = rows.slice(0, limit);
        }
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("from enterprise_collab_room_members")) {
        let rows = members.filter((item) => item.room_id === params[0]);
        if (sql.includes("tenant_id =")) rows = rows.filter((item) => item.tenant_id === params[1]);
        if (sql.includes("left_at is null")) rows = rows.filter((item) => item.left_at == null);
        if (sql.includes("member_type = 'human'")) rows = rows.filter((item) => item.member_type === "human");
        if (sql.includes("member_id =")) rows = rows.filter((item) => item.member_id === params[params.length - 1]);
        if (sql.includes("limit 1")) rows = rows.slice(0, 1);
        return { rows, rowCount: rows.length };
      }
      throw new Error(`unhandled sql: ${sql}`);
    },
    async transaction(callback) {
      return callback(client);
    },
    close() {},
  };
  return client;
}

async function setupProject() {
  const client = createMemoryClient();
  const store = new SqlCollabRoomStore("postgresql", client);
  const project = await store.createProject(ctx, {
    name: "阿尔法",
    displayName: "Alice",
    memberUserIds: [{ userId: OTHER, displayName: "Bob" }],
  });
  return { client, store, project };
}

describe("project collaboration store", () => {
  it("createProject opens a main room with owner, meta and invitees", async () => {
    const { store, project } = await setupProject();
    expect(project.main_room_id).toBeTruthy();
    const main = await store.getRoom(ctx, project.main_room_id);
    expect(main.room_kind).toBe("main");
    const members = await store.listMembers(ctx, project.main_room_id);
    expect(members.map((member) => `${member.member_type}:${member.member_id}`).sort()).toEqual(
      [`human:${OTHER}`, `human:${USER}`, "meta:meta"].sort(),
    );
    expect(members.find((member) => member.member_id === USER)?.room_role).toBe("owner");
  });

  it("createSubRoom rejects a member who is not in the parent room", async () => {
    const { store, project } = await setupProject();
    await expect(
      store.createSubRoom(ctx, project.main_room_id, {
        title: "小群",
        memberUserIds: [{ userId: "01USERCCCCCCCCCCCCCCCCCC", displayName: "Cara" }],
      }),
    ).rejects.toBeInstanceOf(CollabRoomBadRequestError);
  });

  it("openDirectRoom returns the same room for the same pair", async () => {
    const { client, store, project } = await setupProject();
    const first = await store.openDirectRoom(ctx, project.id, {
      peerUserId: OTHER,
      peerDisplayName: "Bob",
    });
    const second = await store.openDirectRoom(ctx, project.id, {
      peerUserId: OTHER,
      peerDisplayName: "Bob",
    });
    expect(second.id).toBe(first.id);
    expect(client.memory.rooms.filter((room) => room.room_kind === "direct")).toHaveLength(1);
    expect(first.room_kind).toBe("direct");
  });

  it("appendMessage with the same clientMsgId returns the original seq", async () => {
    const { client, store, project } = await setupProject();
    const first = await store.appendMessage(ctx, project.main_room_id, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "hello",
      clientMsgId: "client-1",
    });
    const second = await store.appendMessage(ctx, project.main_room_id, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "hello again",
      clientMsgId: "client-1",
    });
    expect(second.id).toBe(first.id);
    expect(second.seq).toBe(first.seq);
    expect(client.memory.messages.filter((message) => message.room_id === project.main_room_id)).toHaveLength(1);
  });

  it("mergeBack from a sub room writes one merge_back message per mode", async () => {
    const { store, project } = await setupProject();
    const sub = await store.createSubRoom(ctx, project.main_room_id, {
      title: "小群",
      memberUserIds: [{ userId: OTHER, displayName: "Bob" }],
    });
    const first = await store.appendMessage(ctx, sub.id, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "第一条",
    });
    await store.appendMessage(ctx, sub.id, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "第二条",
    });
    const merged = [
      await store.mergeBack(ctx, sub.id, { targetRoomId: project.main_room_id, mode: "all" }),
      await store.mergeBack(ctx, sub.id, {
        targetRoomId: project.main_room_id,
        mode: "selected",
        messageIds: [first.id],
      }),
      await store.mergeBack(ctx, sub.id, {
        targetRoomId: project.main_room_id,
        mode: "summary",
        summaryText: "两句话的摘要",
      }),
    ];
    expect(merged).toHaveLength(3);
    for (const item of merged) {
      expect(item.pending).toBe(false);
      if (item.pending) continue;
      expect(item.message.metadata?.kind).toBe("merge_back");
      expect(item.message.content.startsWith("【合回")).toBe(true);
    }
  });

  it("mergeBack from a direct room stays pending until the other person approves", async () => {
    const { store, project } = await setupProject();
    const direct = await store.openDirectRoom(ctx, project.id, {
      peerUserId: OTHER,
      peerDisplayName: "Bob",
    });
    await store.appendMessage(ctx, direct.id, {
      senderType: "human",
      senderId: USER,
      senderName: "Alice",
      content: "私下说一句",
    });
    const pending = await store.mergeBack(ctx, direct.id, {
      targetRoomId: project.main_room_id,
      mode: "all",
    });
    expect(pending.pending).toBe(true);
    if (!pending.pending) return;
    const before = await store.listMessages(ctx, project.main_room_id);
    expect(before.some((message) => message.metadata?.kind === "merge_back")).toBe(false);
    const approved = await store.approveMerge(
      { tenantId: TENANT, userId: OTHER },
      direct.id,
      pending.request_seq,
    );
    expect(approved.metadata?.kind).toBe("merge_back");
    expect(approved.content.startsWith("【合回")).toBe(true);
    const after = await store.listMessages(ctx, project.main_room_id);
    expect(after.some((message) => message.id === approved.id)).toBe(true);
  });
});
