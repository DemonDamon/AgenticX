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
});
