import { ulid } from "ulid";
import type { SqlClient, SqlDialect } from "../chat-history/sql-store";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
  type CollabMemberType,
  type CollabMergeMode,
  type CollabMergeResult,
  type CollabProject,
  type CollabProjectRoom,
  type CollabProjectSettings,
  type CollabRoom,
  type CollabRoomContext,
  type CollabRoomKind,
  type CollabRoomMember,
  type CollabRoomMessage,
  type CollabRoomRole,
  type CollabRoomStore,
  type CollabSenderType,
} from "./types";

const DEFAULT_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 500;
const TITLE_MAX = 160;
const PROJECT_NAME_MAX = 32;
const MERGE_CONTENT_LIMIT = 12000;
const MERGE_TRUNCATED_SUFFIX = "…（完整记录见原群）";
const EMPTY_SETTINGS: CollabProjectSettings = { connectors: [], experts: [], skills: [] };

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

function parseRoomKind(value: unknown): CollabRoomKind {
  if (value === "main" || value === "sub" || value === "direct" || value === "room") return value;
  return "room";
}

function isMergeMode(value: unknown): value is CollabMergeMode {
  return value === "all" || value === "selected" || value === "summary";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseSettings(value: unknown): CollabProjectSettings {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value) as unknown;
    } catch {
      return { ...EMPTY_SETTINGS };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_SETTINGS };
  const record = raw as Record<string, unknown>;
  return {
    connectors: asStringArray(record.connectors),
    experts: asStringArray(record.experts),
    skills: asStringArray(record.skills),
  };
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function clipMergeContent(content: string): string {
  if (content.length <= MERGE_CONTENT_LIMIT) return content;
  const budget = Math.max(0, MERGE_CONTENT_LIMIT - MERGE_TRUNCATED_SUFFIX.length);
  return `${content.slice(0, budget)}${MERGE_TRUNCATED_SUFFIX}`;
}

function buildMergeContent(
  sourceTitle: string,
  mode: CollabMergeMode,
  messages: CollabRoomMessage[],
  summaryText: string,
): string {
  if (mode === "summary") {
    return clipMergeContent(`【合回摘要自「${sourceTitle}」】\n${summaryText}`);
  }
  const lines = messages.map((message) => `${message.sender_name}：${message.content}`);
  const head = `【合回自「${sourceTitle}」，共 ${messages.length} 条】`;
  return clipMergeContent(lines.length > 0 ? `${head}\n${lines.join("\n")}` : head);
}

function participantsOf(messages: CollabRoomMessage[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const message of messages) {
    if (seen.has(message.sender_name)) continue;
    seen.add(message.sender_name);
    names.push(message.sender_name);
  }
  return names;
}

function isClientMsgIdViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const record = error as { constraint?: unknown; message?: unknown; sqlMessage?: unknown };
  const text = `${String(record.constraint ?? "")} ${String(record.message ?? "")} ${String(record.sqlMessage ?? "")}`;
  return text.includes("room_client") || text.includes("client_msg_id");
}

function mapRoom(row: Record<string, unknown>): CollabRoom {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    title: String(row.title),
    created_by: String(row.created_by),
    project_id: row.project_id == null ? null : String(row.project_id),
    parent_room_id: row.parent_room_id == null ? null : String(row.parent_room_id),
    room_kind: parseRoomKind(row.room_kind),
    archived_at: optionalIso(row.archived_at),
    member_count: Number(row.member_count ?? 0),
    last_message_at: optionalIso(row.last_message_at),
    last_seq: Number(row.last_seq ?? 0),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): CollabProject {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    name: String(row.name),
    instructions: row.instructions == null ? null : String(row.instructions),
    owner_user_id: String(row.owner_user_id),
    dept_id: row.dept_id == null ? null : String(row.dept_id),
    main_room_id: row.main_room_id == null ? "" : String(row.main_room_id),
    settings: parseSettings(row.settings),
    archived_at: nullableIso(row.archived_at),
    member_count: Number(row.member_count ?? 0),
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
    client_msg_id: row.client_msg_id == null || row.client_msg_id === "" ? null : String(row.client_msg_id),
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
    userId = ctx.userId,
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
      [roomId, ctx.tenantId, userId],
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

  public async addAgentMember(
    ctx: CollabRoomContext,
    roomId: string,
    input: { agentId: string; displayName: string },
  ): Promise<CollabRoomMember> {
    await this.requireActiveMember(this.client, ctx, roomId);
    const agentId = input.agentId.trim();
    const displayName = input.displayName.trim();
    if (!agentId) throw new CollabRoomBadRequestError("agent required");
    if (!displayName) throw new CollabRoomBadRequestError("displayName required");

    const existing = await this.client.query(
      `select * from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and member_type = 'agent'
          and member_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [roomId, agentId],
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
                room_role = 'member',
                updated_at = ${this.p ? "$2" : "?"}
          where room_id = ${this.p ? "$3" : "?"}
            and member_type = 'agent'
            and member_id = ${this.p ? "$4" : "?"}`,
        [displayName, now, roomId, agentId],
      );
      const refreshed = await this.client.query(
        `select * from enterprise_collab_room_members
          where room_id = ${this.p ? "$1" : "?"}
            and member_type = 'agent'
            and member_id = ${this.p ? "$2" : "?"}
          limit 1`,
        [roomId, agentId],
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
      [id, roomId, ctx.tenantId, "agent", agentId, displayName, "member", now, null, now, now],
    );
    return {
      id,
      room_id: roomId,
      member_type: "agent",
      member_id: agentId,
      display_name: displayName,
      room_role: "member",
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
      clientMsgId?: string;
    },
  ): Promise<CollabRoomMessage> {
    if (!input.content?.trim()) throw new CollabRoomBadRequestError("content required");
    const clientMsgId = input.clientMsgId?.trim() || "";
    if (clientMsgId.length > 64) throw new CollabRoomBadRequestError("clientMsgId too long");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.transaction(async (tx) => {
          await this.requireActiveMember(tx, ctx, roomId);
          if (clientMsgId) {
            const existing = await this.findMessageByClientId(tx, roomId, clientMsgId);
            if (existing) return existing;
          }
          return this.insertMessageOn(tx, {
            roomId,
            tenantId: ctx.tenantId,
            senderType: input.senderType,
            senderId: input.senderId,
            senderName: input.senderName,
            content: input.content,
            model: input.model,
            metadata: input.metadata,
            clientMsgId: clientMsgId || null,
          });
        });
      } catch (error) {
        if (clientMsgId && isClientMsgIdViolation(error)) {
          await this.requireActiveMember(this.client, ctx, roomId);
          const existing = await this.findMessageByClientId(this.client, roomId, clientMsgId);
          if (existing) return existing;
        }
        lastError = error;
        if (attempt === 2 || !isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("unreachable");
  }

  public async findMessageByClientMsgId(
    ctx: CollabRoomContext,
    roomId: string,
    clientMsgId: string,
  ): Promise<CollabRoomMessage | null> {
    const id = clientMsgId.trim();
    if (!id) return null;
    await this.requireActiveMember(this.client, ctx, roomId);
    return this.findMessageByClientId(this.client, roomId, id);
  }

  public async appendAgentMessageAsSystem(
    tenantId: string,
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
          const room = await tx.query(
            `select id from enterprise_collab_rooms
              where id = ${this.p ? "$1" : "?"} and tenant_id = ${this.p ? "$2" : "?"} limit 1`,
            [roomId, tenantId],
          );
          if (!room.rows[0]) throw new CollabRoomNotFoundError();
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
              tenantId,
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
            tenant_id: tenantId,
            seq: nextSeq,
            sender_type: input.senderType,
            sender_id: input.senderId,
            sender_name: input.senderName,
            content: input.content,
            model: input.model,
            metadata: input.metadata,
            client_msg_id: null,
            created_at: now.toISOString(),
          };
        });
      } catch (error) {
        lastError = error;
        if (error instanceof CollabRoomNotFoundError) throw error;
        if (attempt === 2 || !isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("unreachable");
  }

  private async findMessageByClientId(
    client: SqlClient,
    roomId: string,
    clientMsgId: string,
  ): Promise<CollabRoomMessage | null> {
    const existing = await client.query(
      `select * from enterprise_collab_room_messages
        where room_id = ${this.p ? "$1" : "?"} and client_msg_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [roomId, clientMsgId],
    );
    return existing.rows[0] ? mapMessage(existing.rows[0]) : null;
  }

  private async insertMessageOn(
    tx: SqlClient,
    input: {
      roomId: string;
      tenantId: string;
      senderType: CollabSenderType;
      senderId: string;
      senderName: string;
      content: string;
      model?: string;
      metadata?: Record<string, unknown>;
      clientMsgId?: string | null;
    },
  ): Promise<CollabRoomMessage> {
    const maxRow = await tx.query(
      `select coalesce(max(seq), 0) as max_seq from enterprise_collab_room_messages
        where room_id = ${this.p ? "$1" : "?"}`,
      [input.roomId],
    );
    const nextSeq = Number(maxRow.rows[0]?.max_seq ?? 0) + 1;
    const id = ulid();
    const now = new Date();
    await tx.query(
      `insert into enterprise_collab_room_messages
        (id, room_id, tenant_id, seq, sender_type, sender_id, sender_name,
         content, model, metadata, created_at, updated_at, client_msg_id)
       values (${this.placeholders(13)})`,
      [
        id,
        input.roomId,
        input.tenantId,
        nextSeq,
        input.senderType,
        input.senderId,
        input.senderName,
        input.content,
        input.model ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
        input.clientMsgId ?? null,
      ],
    );
    await tx.query(
      `update enterprise_collab_rooms set updated_at = ${this.p ? "$1" : "?"}
        where id = ${this.p ? "$2" : "?"}`,
      [now, input.roomId],
    );
    return {
      id,
      room_id: input.roomId,
      tenant_id: input.tenantId,
      seq: nextSeq,
      sender_type: input.senderType,
      sender_id: input.senderId,
      sender_name: input.senderName,
      content: input.content,
      model: input.model,
      metadata: input.metadata,
      client_msg_id: input.clientMsgId ?? null,
      created_at: now.toISOString(),
    };
  }

  private async insertRoom(
    tx: SqlClient,
    row: {
      id: string;
      tenantId: string;
      title: string;
      createdBy: string;
      projectId: string | null;
      parentRoomId: string | null;
      roomKind: CollabRoomKind;
      now: Date;
    },
  ): Promise<void> {
    await tx.query(
      `insert into enterprise_collab_rooms
        (id, tenant_id, title, created_by, project_id, parent_room_id, room_kind,
         archived_at, created_at, updated_at)
       values (${this.placeholders(10)})`,
      [
        row.id,
        row.tenantId,
        row.title,
        row.createdBy,
        row.projectId,
        row.parentRoomId,
        row.roomKind,
        null,
        row.now,
        row.now,
      ],
    );
  }

  private async insertMember(
    tx: SqlClient,
    row: {
      roomId: string;
      tenantId: string;
      memberType: CollabMemberType;
      memberId: string;
      displayName: string;
      role: CollabRoomRole;
      now: Date;
    },
  ): Promise<void> {
    await tx.query(
      `insert into enterprise_collab_room_members
        (id, room_id, tenant_id, member_type, member_id, display_name, room_role,
         joined_at, left_at, created_at, updated_at)
       values (${this.placeholders(11)})`,
      [
        ulid(),
        row.roomId,
        row.tenantId,
        row.memberType,
        row.memberId,
        row.displayName,
        row.role,
        row.now,
        null,
        row.now,
        row.now,
      ],
    );
  }

  private async loadProject(
    client: SqlClient,
    ctx: CollabRoomContext,
    projectId: string,
  ): Promise<CollabProject | null> {
    const result = await client.query(
      `select p.*,
              (select count(*) from enterprise_collab_room_members m
                where m.room_id = p.main_room_id and m.left_at is null) as member_count
         from enterprise_projects p
        where p.id = ${this.p ? "$1" : "?"} and p.tenant_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [projectId, ctx.tenantId],
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  private async loadRoomKind(
    client: SqlClient,
    ctx: CollabRoomContext,
    roomId: string,
  ): Promise<{ id: string; project_id: string | null; title: string; room_kind: CollabRoomKind }> {
    const result = await client.query(
      `select id, project_id, title, room_kind, parent_room_id
         from enterprise_collab_rooms
        where id = ${this.p ? "$1" : "?"} and tenant_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [roomId, ctx.tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new CollabRoomNotFoundError();
    return {
      id: String(row.id),
      project_id: row.project_id == null ? null : String(row.project_id),
      title: String(row.title),
      room_kind: parseRoomKind(row.room_kind),
    };
  }

  private async listActiveMembers(
    client: SqlClient,
    ctx: CollabRoomContext,
    roomId: string,
  ): Promise<Array<{ member_type: string; member_id: string; display_name: string }>> {
    const result = await client.query(
      `select member_type, member_id, display_name
         from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
          and left_at is null`,
      [roomId, ctx.tenantId],
    );
    return result.rows.map((row) => ({
      member_type: String(row.member_type),
      member_id: String(row.member_id),
      display_name: String(row.display_name),
    }));
  }

  private async loadMergeMessages(
    client: SqlClient,
    ctx: CollabRoomContext,
    roomId: string,
    messageIds: string[] | undefined,
  ): Promise<CollabRoomMessage[]> {
    if (messageIds && messageIds.length === 0) return [];
    if (messageIds) {
      const result = await client.query(
        `select * from enterprise_collab_room_messages
          where room_id = ${this.p ? "$1" : "?"}
            and tenant_id = ${this.p ? "$2" : "?"}
            and id in (${this.placeholders(messageIds.length, 2)})
          order by seq asc`,
        [roomId, ctx.tenantId, ...messageIds],
      );
      const messages = result.rows.map(mapMessage);
      if (messages.length !== messageIds.length) {
        throw new CollabRoomBadRequestError("message is not in the source room");
      }
      return messages;
    }
    const result = await client.query(
      `select * from enterprise_collab_room_messages
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
        order by seq asc`,
      [roomId, ctx.tenantId],
    );
    return result.rows.map(mapMessage);
  }

  private async appendMergedMessage(
    ctx: CollabRoomContext,
    targetRoomId: string,
    input: {
      source: { id: string; title: string };
      mode: CollabMergeMode;
      messages: CollabRoomMessage[];
      summaryText: string;
      senderId: string;
      senderName: string;
      messageIds: string[];
    },
  ): Promise<CollabRoomMessage> {
    const seqs = input.messages.map((message) => message.seq);
    return this.appendMessage(ctx, targetRoomId, {
      senderType: "system",
      senderId: input.senderId,
      senderName: input.senderName,
      content: buildMergeContent(input.source.title, input.mode, input.messages, input.summaryText),
      metadata: {
        kind: "merge_back",
        source_room_id: input.source.id,
        source_title: input.source.title,
        mode: input.mode,
        message_ids: input.messageIds,
        participants: participantsOf(input.messages),
        from_seq: seqs.length > 0 ? Math.min(...seqs) : 0,
        to_seq: seqs.length > 0 ? Math.max(...seqs) : 0,
        count: input.mode === "summary" ? input.messageIds.length : input.messages.length,
      },
    });
  }

  public async createProject(
    ctx: CollabRoomContext,
    input: {
      name: string;
      instructions?: string;
      settings?: CollabProjectSettings;
      deptId?: string | null;
      displayName: string;
      memberUserIds?: Array<{ userId: string; displayName: string }>;
    },
  ): Promise<CollabProject> {
    const name = input.name.trim();
    const displayName = input.displayName.trim();
    if (!name) throw new CollabRoomBadRequestError("name required");
    if (name.length > PROJECT_NAME_MAX) throw new CollabRoomBadRequestError("name too long");
    if (!displayName) throw new CollabRoomBadRequestError("displayName required");
    const instructions = input.instructions?.trim() ? input.instructions.trim() : null;
    const settings: CollabProjectSettings = {
      connectors: input.settings?.connectors ?? [],
      experts: input.settings?.experts ?? [],
      skills: input.settings?.skills ?? [],
    };
    const invitees: Array<{ userId: string; displayName: string }> = [];
    const seen = new Set<string>();
    for (const member of input.memberUserIds ?? []) {
      const userId = member.userId.trim();
      const memberName = member.displayName.trim();
      if (!userId || !memberName) throw new CollabRoomBadRequestError("member required");
      if (userId === ctx.userId || seen.has(userId)) continue;
      seen.add(userId);
      const person = await this.client.query(
        `select id, tenant_id from users
          where tenant_id = ${this.p ? "$1" : "?"}
            and id = ${this.p ? "$2" : "?"}
            and is_deleted = ${this.p ? "$3" : "?"}
            and deleted_at is null
          limit 1`,
        [ctx.tenantId, userId, false],
      );
      if (!person.rows[0] || String(person.rows[0].tenant_id) !== ctx.tenantId) {
        throw new CollabRoomBadRequestError("member is not in this tenant");
      }
      invitees.push({ userId, displayName: memberName });
    }

    return this.client.transaction(async (tx) => {
      const projectId = ulid();
      const roomId = ulid();
      const now = new Date();
      await tx.query(
        `insert into enterprise_projects
          (id, tenant_id, name, instructions, owner_user_id, dept_id, main_room_id,
           settings, archived_at, created_at, updated_at)
         values (${this.placeholders(11)})`,
        [
          projectId,
          ctx.tenantId,
          name,
          instructions,
          ctx.userId,
          input.deptId ?? null,
          null,
          JSON.stringify(settings),
          null,
          now,
          now,
        ],
      );
      await this.insertRoom(tx, {
        id: roomId,
        tenantId: ctx.tenantId,
        title: name,
        createdBy: ctx.userId,
        projectId,
        parentRoomId: null,
        roomKind: "main",
        now,
      });
      await this.insertMember(tx, {
        roomId,
        tenantId: ctx.tenantId,
        memberType: "human",
        memberId: ctx.userId,
        displayName,
        role: "owner",
        now,
      });
      await this.insertMember(tx, {
        roomId,
        tenantId: ctx.tenantId,
        memberType: "meta",
        memberId: "meta",
        displayName: "Meta",
        role: "member",
        now,
      });
      for (const member of invitees) {
        await this.insertMember(tx, {
          roomId,
          tenantId: ctx.tenantId,
          memberType: "human",
          memberId: member.userId,
          displayName: member.displayName,
          role: "member",
          now,
        });
      }
      await tx.query(
        `update enterprise_projects
            set main_room_id = ${this.p ? "$1" : "?"}, updated_at = ${this.p ? "$2" : "?"}
          where id = ${this.p ? "$3" : "?"} and tenant_id = ${this.p ? "$4" : "?"}`,
        [roomId, now, projectId, ctx.tenantId],
      );
      const project = await this.loadProject(tx, ctx, projectId);
      if (!project) throw new CollabRoomNotFoundError();
      return project;
    });
  }

  public async listProjects(ctx: CollabRoomContext): Promise<CollabProject[]> {
    const result = await this.client.query(
      `select p.*,
              (select count(*) from enterprise_collab_room_members m
                where m.room_id = p.main_room_id and m.left_at is null) as member_count
         from enterprise_projects p
        where p.tenant_id = ${this.p ? "$1" : "?"}
          and exists (
            select 1 from enterprise_collab_rooms r
            join enterprise_collab_room_members m
              on m.room_id = r.id and m.left_at is null and m.member_type = 'human'
            where r.project_id = p.id and r.tenant_id = p.tenant_id and m.member_id = ${this.p ? "$2" : "?"}
          )
        order by p.updated_at desc`,
      [ctx.tenantId, ctx.userId],
    );
    return result.rows.map(mapProject);
  }

  public async getProject(ctx: CollabRoomContext, projectId: string): Promise<CollabProjectRoom> {
    const project = await this.loadProject(this.client, ctx, projectId);
    if (!project) throw new CollabRoomNotFoundError();
    const member = await this.client.query(
      `select 1 as ok
         from enterprise_collab_rooms r
         join enterprise_collab_room_members m
           on m.room_id = r.id and m.left_at is null and m.member_type = 'human'
        where r.project_id = ${this.p ? "$1" : "?"}
          and r.tenant_id = ${this.p ? "$2" : "?"}
          and m.member_id = ${this.p ? "$3" : "?"}
        limit 1`,
      [projectId, ctx.tenantId, ctx.userId],
    );
    if (!member.rows[0]) throw new CollabRoomForbiddenError();
    const result = await this.client.query(
      `select r.*,
              (select count(*) from enterprise_collab_room_members m2
                where m2.room_id = r.id and m2.left_at is null) as member_count,
              coalesce((select max(seq) from enterprise_collab_room_messages g
                where g.room_id = r.id), 0) as last_seq,
              (select max(created_at) from enterprise_collab_room_messages g2
                where g2.room_id = r.id) as last_message_at
         from enterprise_collab_rooms r
        where r.tenant_id = ${this.p ? "$1" : "?"}
          and r.project_id = ${this.p ? "$2" : "?"}
          and (
            r.room_kind = 'main'
            or (
              r.room_kind in ('sub', 'direct')
              and exists (
                select 1 from enterprise_collab_room_members m
                 where m.room_id = r.id
                   and m.left_at is null
                   and m.member_type = 'human'
                   and m.member_id = ${this.p ? "$3" : "?"}
              )
            )
          )`,
      [ctx.tenantId, projectId, ctx.userId],
    );
    const kindRank: Record<CollabRoomKind, number> = { main: 0, sub: 1, direct: 2, room: 3 };
    const rooms = result.rows.map(mapRoom).sort((a, b) => {
      return kindRank[a.room_kind] - kindRank[b.room_kind] || a.created_at.localeCompare(b.created_at);
    });
    return { project, rooms };
  }

  public async addProjectMember(
    ctx: CollabRoomContext,
    projectId: string,
    input: { userId: string; displayName: string; role?: CollabRoomRole },
  ): Promise<CollabRoomMember> {
    const project = await this.loadProject(this.client, ctx, projectId);
    if (!project) throw new CollabRoomNotFoundError();
    if (!project.main_room_id) throw new CollabRoomBadRequestError("project has no main room");
    const caller = await this.requireActiveMember(this.client, ctx, project.main_room_id);
    if (caller.room_role !== "owner" && caller.room_role !== "admin") {
      throw new CollabRoomForbiddenError("owner or admin required");
    }
    return this.addHumanMember(ctx, project.main_room_id, input);
  }

  public async createSubRoom(
    ctx: CollabRoomContext,
    parentRoomId: string,
    input: {
      title: string;
      memberUserIds: Array<{ userId: string; displayName: string }>;
      agentIds?: string[];
      seedMessageIds?: string[];
    },
  ): Promise<CollabRoom> {
    const title = input.title.trim();
    if (!title) throw new CollabRoomBadRequestError("title required");
    if (title.length > TITLE_MAX) throw new CollabRoomBadRequestError("title too long");
    const caller = await this.requireActiveMember(this.client, ctx, parentRoomId);
    const parent = await this.loadRoomKind(this.client, ctx, parentRoomId);
    const active = await this.listActiveMembers(this.client, ctx, parentRoomId);
    const humans = new Map(
      active.filter((member) => member.member_type === "human").map((member) => [member.member_id, member.display_name]),
    );
    const agents = new Map(
      active.filter((member) => member.member_type === "agent").map((member) => [member.member_id, member.display_name]),
    );
    const invitees: Array<{ userId: string; displayName: string }> = [];
    const seen = new Set<string>();
    for (const member of input.memberUserIds) {
      const userId = member.userId.trim();
      const displayName = member.displayName.trim();
      if (!userId || !displayName) throw new CollabRoomBadRequestError("member required");
      if (!humans.has(userId)) throw new CollabRoomBadRequestError("member is not in the parent room");
      if (userId === ctx.userId || seen.has(userId)) continue;
      seen.add(userId);
      invitees.push({ userId, displayName });
    }
    const agentIds: string[] = [];
    const seenAgents = new Set<string>();
    for (const rawId of input.agentIds ?? []) {
      const agentId = rawId.trim();
      if (!agentId) throw new CollabRoomBadRequestError("agent required");
      if (!agents.has(agentId)) throw new CollabRoomBadRequestError("agent is not in the parent room");
      if (seenAgents.has(agentId)) continue;
      seenAgents.add(agentId);
      agentIds.push(agentId);
    }
    const seedIds = [...new Set((input.seedMessageIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const seeded = seedIds.length
      ? await this.loadMergeMessages(this.client, ctx, parentRoomId, seedIds)
      : [];

    return this.client.transaction(async (tx) => {
      const roomId = ulid();
      const now = new Date();
      await this.insertRoom(tx, {
        id: roomId,
        tenantId: ctx.tenantId,
        title,
        createdBy: ctx.userId,
        projectId: parent.project_id,
        parentRoomId,
        roomKind: "sub",
        now,
      });
      await this.insertMember(tx, {
        roomId,
        tenantId: ctx.tenantId,
        memberType: "human",
        memberId: ctx.userId,
        displayName: caller.display_name,
        role: "owner",
        now,
      });
      for (const member of invitees) {
        await this.insertMember(tx, {
          roomId,
          tenantId: ctx.tenantId,
          memberType: "human",
          memberId: member.userId,
          displayName: member.displayName,
          role: "member",
          now,
        });
      }
      for (const agentId of agentIds) {
        await this.insertMember(tx, {
          roomId,
          tenantId: ctx.tenantId,
          memberType: "agent",
          memberId: agentId,
          displayName: agents.get(agentId) ?? agentId,
          role: "member",
          now,
        });
      }
      if (seeded.length > 0) {
        const content = seeded.map((message) => `${message.sender_name}：${message.content}`).join("\n");
        await this.insertMessageOn(tx, {
          roomId,
          tenantId: ctx.tenantId,
          senderType: "system",
          senderId: ctx.userId,
          senderName: caller.display_name,
          content: content || "（无内容）",
          metadata: {
            kind: "seed",
            source_room_id: parentRoomId,
            message_ids: seeded.map((message) => message.id),
          },
        });
      }
      return this.loadRoom(tx, ctx, roomId);
    });
  }

  public async openDirectRoom(
    ctx: CollabRoomContext,
    projectId: string,
    input: { peerUserId: string; peerDisplayName: string },
  ): Promise<CollabRoom> {
    const peerUserId = input.peerUserId.trim();
    const peerDisplayName = input.peerDisplayName.trim();
    if (!peerUserId || !peerDisplayName) throw new CollabRoomBadRequestError("peer required");
    if (peerUserId === ctx.userId) throw new CollabRoomBadRequestError("peer must be another member");
    const project = await this.client.query(
      `select id, main_room_id from enterprise_projects
        where id = ${this.p ? "$1" : "?"} and tenant_id = ${this.p ? "$2" : "?"}
        limit 1`,
      [projectId, ctx.tenantId],
    );
    const projectRow = project.rows[0];
    if (!projectRow) throw new CollabRoomNotFoundError();
    const mainRoomId = projectRow.main_room_id == null ? "" : String(projectRow.main_room_id);
    if (!mainRoomId) throw new CollabRoomBadRequestError("project has no main room");
    const caller = await this.requireActiveMember(this.client, ctx, mainRoomId);
    const peer = await this.client.query(
      `select * from enterprise_collab_room_members
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
          and member_type = 'human'
          and member_id = ${this.p ? "$3" : "?"}
          and left_at is null
        limit 1`,
      [mainRoomId, ctx.tenantId, peerUserId],
    );
    if (!peer.rows[0]) throw new CollabRoomBadRequestError("peer is not a project member");

    return this.client.transaction(async (tx) => {
      const existing = await tx.query(
        `select r.id
           from enterprise_collab_rooms r
          where r.tenant_id = ${this.p ? "$1" : "?"}
            and r.project_id = ${this.p ? "$2" : "?"}
            and r.room_kind = 'direct'
            and exists (
              select 1 from enterprise_collab_room_members m
               where m.room_id = r.id and m.member_type = 'human' and m.member_id = ${this.p ? "$3" : "?"} and m.left_at is null
            )
            and exists (
              select 1 from enterprise_collab_room_members m
               where m.room_id = r.id and m.member_type = 'human' and m.member_id = ${this.p ? "$4" : "?"} and m.left_at is null
            )
          limit 1`,
        [ctx.tenantId, projectId, ctx.userId, peerUserId],
      );
      const existingId = existing.rows[0]?.id;
      if (existingId) return this.loadRoom(tx, ctx, String(existingId));

      const roomId = ulid();
      const now = new Date();
      const title = `${caller.display_name} / ${peerDisplayName}`.slice(0, TITLE_MAX);
      await this.insertRoom(tx, {
        id: roomId,
        tenantId: ctx.tenantId,
        title,
        createdBy: ctx.userId,
        projectId,
        parentRoomId: null,
        roomKind: "direct",
        now,
      });
      await this.insertMember(tx, {
        roomId,
        tenantId: ctx.tenantId,
        memberType: "human",
        memberId: ctx.userId,
        displayName: caller.display_name,
        role: "owner",
        now,
      });
      await this.insertMember(tx, {
        roomId,
        tenantId: ctx.tenantId,
        memberType: "human",
        memberId: peerUserId,
        displayName: peerDisplayName,
        role: "member",
        now,
      });
      return this.loadRoom(tx, ctx, roomId);
    });
  }

  public async mergeBack(
    ctx: CollabRoomContext,
    sourceRoomId: string,
    input: {
      targetRoomId: string;
      mode: CollabMergeMode;
      messageIds?: string[];
      summaryText?: string;
    },
  ): Promise<CollabMergeResult> {
    if (!isMergeMode(input.mode)) throw new CollabRoomBadRequestError("invalid mode");
    if (sourceRoomId === input.targetRoomId) {
      throw new CollabRoomBadRequestError("cannot merge a room into itself");
    }
    const messageIds = input.messageIds ?? [];
    const summaryText = input.summaryText?.trim() ?? "";
    if (input.mode === "selected" && messageIds.length === 0) {
      throw new CollabRoomBadRequestError("messageIds required");
    }
    if (input.mode === "summary" && !summaryText) {
      throw new CollabRoomBadRequestError("summaryText required");
    }
    const sourceMember = await this.requireActiveMember(this.client, ctx, sourceRoomId);
    await this.requireActiveMember(this.client, ctx, input.targetRoomId);
    const source = await this.loadRoomKind(this.client, ctx, sourceRoomId);
    const target = await this.loadRoomKind(this.client, ctx, input.targetRoomId);
    if (!source.project_id || source.project_id !== target.project_id) {
      throw new CollabRoomBadRequestError("rooms are not in the same project");
    }
    const messages =
      input.mode === "summary"
        ? []
        : await this.loadMergeMessages(
            this.client,
            ctx,
            sourceRoomId,
            input.mode === "selected" ? messageIds : undefined,
          );
    const includedIds = input.mode === "summary" ? messageIds : messages.map((message) => message.id);

    switch (source.room_kind) {
      case "direct": {
        const request = await this.appendMessage(ctx, sourceRoomId, {
          senderType: "system",
          senderId: ctx.userId,
          senderName: sourceMember.display_name,
          content: "【合回申请】等待对方确认",
          metadata: {
            kind: "merge_request",
            target_room_id: input.targetRoomId,
            mode: input.mode,
            message_ids: includedIds,
            summary_text: input.mode === "summary" ? summaryText : null,
            requested_by: ctx.userId,
          },
        });
        return { pending: true, request_seq: request.seq };
      }
      case "sub": {
        const message = await this.appendMergedMessage(ctx, input.targetRoomId, {
          source,
          mode: input.mode,
          messages,
          summaryText,
          senderId: ctx.userId,
          senderName: sourceMember.display_name,
          messageIds: includedIds,
        });
        return { pending: false, message };
      }
      case "main":
      case "room":
        throw new CollabRoomBadRequestError("only a sub room or direct room can be merged");
      default: {
        const exhaustive: never = source.room_kind;
        throw new CollabRoomBadRequestError(String(exhaustive));
      }
    }
  }

  public async approveMerge(
    ctx: CollabRoomContext,
    sourceRoomId: string,
    mergeRequestSeq: number,
  ): Promise<CollabRoomMessage> {
    if (!Number.isInteger(mergeRequestSeq) || mergeRequestSeq < 1) {
      throw new CollabRoomBadRequestError("invalid merge request");
    }
    await this.requireActiveMember(this.client, ctx, sourceRoomId);
    const found = await this.client.query(
      `select * from enterprise_collab_room_messages
        where room_id = ${this.p ? "$1" : "?"}
          and tenant_id = ${this.p ? "$2" : "?"}
          and seq = ${this.p ? "$3" : "?"}
        limit 1`,
      [sourceRoomId, ctx.tenantId, mergeRequestSeq],
    );
    if (!found.rows[0]) throw new CollabRoomBadRequestError("merge request not found");
    const request = mapMessage(found.rows[0]);
    const meta = request.metadata;
    if (!meta || meta.kind !== "merge_request") throw new CollabRoomBadRequestError("merge request not found");
    const requestedBy = typeof meta.requested_by === "string" ? meta.requested_by : "";
    if (!requestedBy || requestedBy === ctx.userId) {
      throw new CollabRoomForbiddenError("only the other participant can approve");
    }
    const targetRoomId = typeof meta.target_room_id === "string" ? meta.target_room_id : "";
    if (!targetRoomId || !isMergeMode(meta.mode)) throw new CollabRoomBadRequestError("merge request not found");
    const mode = meta.mode;
    const messageIds = Array.isArray(meta.message_ids)
      ? meta.message_ids.filter((id): id is string => typeof id === "string")
      : [];
    const summaryText = typeof meta.summary_text === "string" ? meta.summary_text.trim() : "";
    if (mode === "summary" && !summaryText) throw new CollabRoomBadRequestError("summaryText required");
    if (mode === "selected" && messageIds.length === 0) {
      throw new CollabRoomBadRequestError("messageIds required");
    }
    if (typeof meta.approved_message_id === "string" && meta.approved_message_id) {
      const approved = await this.client.query(
        `select * from enterprise_collab_room_messages
          where id = ${this.p ? "$1" : "?"}
          limit 1`,
        [meta.approved_message_id],
      );
      if (approved.rows[0]) return mapMessage(approved.rows[0]);
    }
    await this.requireActiveMember(this.client, ctx, targetRoomId);
    const source = await this.loadRoomKind(this.client, ctx, sourceRoomId);
    const target = await this.loadRoomKind(this.client, ctx, targetRoomId);
    if (source.room_kind !== "direct") {
      throw new CollabRoomBadRequestError("only a direct room merge can be approved");
    }
    if (!source.project_id || source.project_id !== target.project_id) {
      throw new CollabRoomBadRequestError("rooms are not in the same project");
    }
    const requester = await this.requireActiveMember(this.client, ctx, sourceRoomId, requestedBy);
    const included = mode === "summary" ? [] : await this.loadMergeMessages(this.client, ctx, sourceRoomId, messageIds);
    const message = await this.appendMergedMessage(ctx, targetRoomId, {
      source,
      mode,
      messages: included,
      summaryText,
      senderId: requestedBy,
      senderName: requester.display_name,
      messageIds,
    });
    await this.client.query(
      `update enterprise_collab_room_messages
          set metadata = ${this.p ? "$1" : "?"}, updated_at = ${this.p ? "$2" : "?"}
        where room_id = ${this.p ? "$3" : "?"} and seq = ${this.p ? "$4" : "?"}`,
      [JSON.stringify({ ...meta, approved_message_id: message.id }), new Date(), sourceRoomId, mergeRequestSeq],
    );
    return message;
  }

  public async resetForTests(): Promise<void> {
    await this.client.close();
  }
}
