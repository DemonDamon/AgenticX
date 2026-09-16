import { ulid } from "ulid";
import type { SqlClient, SqlDialect } from "../chat-history/sql-store";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
  type CollabMemberType,
  type CollabRoom,
  type CollabRoomContext,
  type CollabRoomMember,
  type CollabRoomMessage,
  type CollabRoomRole,
  type CollabRoomStore,
  type CollabSenderType,
} from "./types";

const DEFAULT_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 500;
const TITLE_MAX = 160;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toIso(value: unknown): string {
  return toDate(value).toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (value == null) return undefined;
  return toIso(value);
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function mapRoom(row: Record<string, unknown>): CollabRoom {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    title: String(row.title),
    created_by: String(row.created_by),
    archived_at: optionalIso(row.archived_at),
    member_count: Number(row.member_count ?? 0),
    last_message_at: optionalIso(row.last_message_at),
    last_seq: Number(row.last_seq ?? 0),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function mapMember(row: Record<string, unknown>): CollabRoomMember {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    member_type: String(row.member_type) as CollabMemberType,
    member_id: String(row.member_id),
    display_name: String(row.display_name),
    room_role: String(row.room_role) as CollabRoomRole,
    joined_at: toIso(row.joined_at),
    left_at: optionalIso(row.left_at),
  };
}

function mapMessage(row: Record<string, unknown>): CollabRoomMessage {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    tenant_id: String(row.tenant_id),
    seq: Number(row.seq),
    sender_type: String(row.sender_type) as CollabSenderType,
    sender_id: String(row.sender_id),
    sender_name: String(row.sender_name),
    content: String(row.content),
    model: row.model == null ? undefined : String(row.model),
    metadata: parseMetadata(row.metadata),
    created_at: toIso(row.created_at),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const coded = error as { code?: string | number; errno?: number };
  return coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062;
}

function roomStatsSql(p: boolean): string {
  return `select r.*,
       (select count(*) from enterprise_collab_room_members m2
         where m2.room_id = r.id and m2.left_at is null) as member_count,
       coalesce((select max(seq) from enterprise_collab_room_messages g
         where g.room_id = r.id), 0) as last_seq,
       (select max(created_at) from enterprise_collab_room_messages g2
         where g2.room_id = r.id) as last_message_at
  from enterprise_collab_rooms r
 where r.id = ${p ? "$1" : "?"} and r.tenant_id = ${p ? "$2" : "?"}`;
}

export class SqlCollabRoomStore implements CollabRoomStore {
  public constructor(
    private readonly dialect: SqlDialect,
    private readonly client: SqlClient,
  ) {}

  private get p(): boolean {
    return this.dialect === "postgresql";
  }

  private placeholders(count: number, offset = 0): string {
    return Array.from({ length: count }, (_, index) =>
      this.dialect === "postgresql" ? `$${offset + index + 1}` : "?",
    ).join(", ");
  }

  /**
   * 活跃成员校验。房间存在但调用者不是活跃成员 → Forbidden；
   * 房间不存在（含跨租户）→ NotFound。
   * 语义刻意与「离开只写 left_at」配套：left_at 非空的人等价于非成员。
   */
  private async requireActiveMember(
    client: SqlClient,
    ctx: CollabRoomContext,
    roomId: string,
  ): Promise<CollabRoomMember> {
    const room = await client.query(
      `select id from enterprise_collab_rooms
        where id = ${this.p ? "$1" : "?"} and tenant_id = ${this.p ? "$2" : "?"} limit 1`,
      [roomId, ctx.tenantId],
    );
    if (!room.rows[0]) throw new CollabRoomNotFoundError();

    const member = await client.query(
      `select * from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
          and member_type = 'human'
          and member_id = ${this.p ? "$3" : "?"}
          and left_at is null
        limit 1`,
      [roomId, ctx.tenantId, ctx.userId],
    );
    if (!member.rows[0]) throw new CollabRoomForbiddenError();
    return mapMember(member.rows[0]);
  }

  private async loadRoom(
    client: SqlClient,
    ctx: CollabRoomContext,
    roomId: string,
  ): Promise<CollabRoom> {
    const result = await client.query(roomStatsSql(this.p), [roomId, ctx.tenantId]);
    if (!result.rows[0]) throw new CollabRoomNotFoundError();
    return mapRoom(result.rows[0]);
  }

  public async listRooms(ctx: CollabRoomContext): Promise<CollabRoom[]> {
    const result = await this.client.query(
      `select r.*,
       (select count(*) from enterprise_collab_room_members m2
         where m2.room_id = r.id and m2.left_at is null) as member_count,
       coalesce((select max(seq) from enterprise_collab_room_messages g
         where g.room_id = r.id), 0) as last_seq,
       (select max(created_at) from enterprise_collab_room_messages g2
         where g2.room_id = r.id) as last_message_at
  from enterprise_collab_rooms r
  join enterprise_collab_room_members m
    on m.room_id = r.id
   and m.left_at is null
   and m.member_type = 'human'
 where r.tenant_id = ${this.p ? "$1" : "?"}
   and m.member_id = ${this.p ? "$2" : "?"}
 order by r.updated_at desc`,
      [ctx.tenantId, ctx.userId],
    );
    return result.rows.map(mapRoom);
  }

  public async createRoom(
    ctx: CollabRoomContext,
    input: { title: string; displayName: string },
  ): Promise<CollabRoom> {
    const title = input.title.trim();
    const displayName = input.displayName.trim();
    if (!title) throw new CollabRoomBadRequestError("title required");
    if (title.length > TITLE_MAX) throw new CollabRoomBadRequestError("title too long");
    if (!displayName) throw new CollabRoomBadRequestError("displayName required");

    return this.client.transaction(async (tx) => {
      const id = ulid();
      const now = new Date();
      await tx.query(
        `insert into enterprise_collab_rooms
          (id, tenant_id, title, created_by, archived_at, created_at, updated_at)
         values (${this.placeholders(7)})`,
        [id, ctx.tenantId, title, ctx.userId, null, now, now],
      );
      await tx.query(
        `insert into enterprise_collab_room_members
          (id, room_id, tenant_id, member_type, member_id, display_name, room_role,
           joined_at, left_at, created_at, updated_at)
         values (${this.placeholders(11)})`,
        [ulid(), id, ctx.tenantId, "human", ctx.userId, displayName, "owner", now, null, now, now],
      );
      await tx.query(
        `insert into enterprise_collab_room_members
          (id, room_id, tenant_id, member_type, member_id, display_name, room_role,
           joined_at, left_at, created_at, updated_at)
         values (${this.placeholders(11)})`,
        [ulid(), id, ctx.tenantId, "meta", "meta", "Meta", "member", now, null, now, now],
      );
      return this.loadRoom(tx, ctx, id);
    });
  }

  public async getRoom(ctx: CollabRoomContext, roomId: string): Promise<CollabRoom> {
    await this.requireActiveMember(this.client, ctx, roomId);
    return this.loadRoom(this.client, ctx, roomId);
  }

  public async listMembers(ctx: CollabRoomContext, roomId: string): Promise<CollabRoomMember[]> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const result = await this.client.query(
      `select * from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
          and left_at is null
        order by joined_at asc`,
      [roomId, ctx.tenantId],
    );
    return result.rows.map(mapMember);
  }

  public async addHumanMember(
    ctx: CollabRoomContext,
    roomId: string,
    input: { userId: string; displayName: string; role?: CollabRoomRole },
  ): Promise<CollabRoomMember> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const target = input.userId.trim();
    if (!target) throw new CollabRoomBadRequestError("member required");
    const role: CollabRoomRole = input.role ?? "member";

    const person = await this.client.query(
      `select id, tenant_id, email, display_name from users
        where tenant_id = ${this.p ? "$1" : "?"}
          and is_deleted = ${this.p ? "$2" : "?"}
          and deleted_at is null
          and (id = ${this.p ? "$3" : "?"} or lower(email) = lower(${this.p ? "$4" : "?"}))
        limit 1`,
      [ctx.tenantId, false, target, target],
    );
    const personRow = person.rows[0];
    if (!personRow || String(personRow.tenant_id) !== ctx.tenantId) {
      throw new CollabRoomBadRequestError("member is not in this tenant");
    }
    const resolvedId = String(personRow.id);
    const fromDb =
      String(personRow.display_name ?? "").trim() ||
      String(personRow.email ?? "").trim() ||
      resolvedId;
    const requestedName = input.displayName.trim();
    const displayName = requestedName && requestedName !== target ? requestedName : fromDb;
    if (!displayName) throw new CollabRoomBadRequestError("displayName required");

    const existing = await this.client.query(
      `select * from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and member_type = 'human'
          and member_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [roomId, resolvedId],
    );
    const existingRow = existing.rows[0];
    if (existingRow && existingRow.left_at == null) {
      return mapMember(existingRow);
    }

    const now = new Date();
    if (existingRow) {
      await this.client.query(
        `update enterprise_collab_room_members
            set left_at = null,
                display_name = ${this.p ? "$1" : "?"},
                room_role = ${this.p ? "$2" : "?"},
                updated_at = ${this.p ? "$3" : "?"}
          where room_id = ${this.p ? "$4" : "?"}
            and member_type = 'human'
            and member_id = ${this.p ? "$5" : "?"}`,
        [displayName, role, now, roomId, resolvedId],
      );
      const refreshed = await this.client.query(
        `select * from enterprise_collab_room_members
          where room_id = ${this.p ? "$1" : "?"}
            and member_type = 'human'
            and member_id = ${this.p ? "$2" : "?"}
          limit 1`,
        [roomId, resolvedId],
      );
      if (!refreshed.rows[0]) throw new CollabRoomNotFoundError();
      return mapMember(refreshed.rows[0]);
    }

    const id = ulid();
    await this.client.query(
      `insert into enterprise_collab_room_members
        (id, room_id, tenant_id, member_type, member_id, display_name, room_role,
         joined_at, left_at, created_at, updated_at)
       values (${this.placeholders(11)})`,
      [id, roomId, ctx.tenantId, "human", resolvedId, displayName, role, now, null, now, now],
    );
    return {
      id,
      room_id: roomId,
      member_type: "human",
      member_id: resolvedId,
      display_name: displayName,
      room_role: role,
      joined_at: now.toISOString(),
    };
  }

  public async removeMember(ctx: CollabRoomContext, roomId: string, memberId: string): Promise<void> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const now = new Date();
    await this.client.query(
      `update enterprise_collab_room_members
          set left_at = ${this.p ? "$1" : "?"},
              updated_at = ${this.p ? "$2" : "?"}
        where room_id = ${this.p ? "$3" : "?"}
          and tenant_id = ${this.p ? "$4" : "?"}
          and member_id = ${this.p ? "$5" : "?"}
          and left_at is null`,
      [now, now, roomId, ctx.tenantId, memberId],
    );
  }

  public async leaveRoom(ctx: CollabRoomContext, roomId: string): Promise<void> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const now = new Date();
    await this.client.query(
      `update enterprise_collab_room_members
          set left_at = ${this.p ? "$1" : "?"},
              updated_at = ${this.p ? "$2" : "?"}
        where room_id = ${this.p ? "$3" : "?"}
          and tenant_id = ${this.p ? "$4" : "?"}
          and member_type = 'human'
          and member_id = ${this.p ? "$5" : "?"}
          and left_at is null`,
      [now, now, roomId, ctx.tenantId, ctx.userId],
    );
  }

  public async listMessages(
    ctx: CollabRoomContext,
    roomId: string,
    options?: { afterSeq?: number; limit?: number },
  ): Promise<CollabRoomMessage[]> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const limit = Math.min(
      Math.max(1, options?.limit ?? DEFAULT_MESSAGE_LIMIT),
      MAX_MESSAGE_LIMIT,
    );
    const afterSeq = options?.afterSeq;
    if (afterSeq != null) {
      const result = await this.client.query(
        `select * from enterprise_collab_room_messages
          where room_id = ${this.p ? "$1" : "?"}
            and tenant_id = ${this.p ? "$2" : "?"}
            and seq > ${this.p ? "$3" : "?"}
          order by seq asc
          limit ${this.p ? "$4" : "?"}`,
        [roomId, ctx.tenantId, afterSeq, limit],
      );
      return result.rows.map(mapMessage);
    }
    const result = await this.client.query(
      `select * from enterprise_collab_room_messages
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
        order by seq asc
        limit ${this.p ? "$3" : "?"}`,
      [roomId, ctx.tenantId, limit],
    );
    return result.rows.map(mapMessage);
  }

  public async appendMessage(
    ctx: CollabRoomContext,
    roomId: string,
    input: {
      senderType: CollabSenderType;
      senderId: string;
      senderName: string;
      content: string;
      model?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<CollabRoomMessage> {
    if (!input.content?.trim()) throw new CollabRoomBadRequestError("content required");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.transaction(async (tx) => {
          await this.requireActiveMember(tx, ctx, roomId);
          const maxRow = await tx.query(
            `select coalesce(max(seq), 0) as max_seq from enterprise_collab_room_messages
              where room_id = ${this.p ? "$1" : "?"}`,
            [roomId],
          );
          const nextSeq = Number(maxRow.rows[0]?.max_seq ?? 0) + 1;
          const id = ulid();
          const now = new Date();
          await tx.query(
            `insert into enterprise_collab_room_messages
              (id, room_id, tenant_id, seq, sender_type, sender_id, sender_name,
               content, model, metadata, created_at, updated_at)
             values (${this.placeholders(12)})`,
            [
              id,
              roomId,
              ctx.tenantId,
              nextSeq,
              input.senderType,
              input.senderId,
              input.senderName,
              input.content,
              input.model ?? null,
              input.metadata ? JSON.stringify(input.metadata) : null,
              now,
              now,
            ],
          );
          await tx.query(
            `update enterprise_collab_rooms set updated_at = ${this.p ? "$1" : "?"}
              where id = ${this.p ? "$2" : "?"}`,
            [now, roomId],
          );
          return {
            id,
            room_id: roomId,
            tenant_id: ctx.tenantId,
            seq: nextSeq,
            sender_type: input.senderType,
            sender_id: input.senderId,
            sender_name: input.senderName,
            content: input.content,
            model: input.model,
            metadata: input.metadata,
            created_at: now.toISOString(),
          };
        });
      } catch (error) {
        lastError = error;
        if (attempt === 2 || !isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("unreachable");
  }

  public async resetForTests(): Promise<void> {
    await this.client.close();
  }
}
