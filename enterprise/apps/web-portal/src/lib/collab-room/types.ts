export type CollabRoomContext = {
  tenantId: string;
  userId: string;
};

export type CollabMemberType = "human" | "meta" | "agent";
export type CollabSenderType = CollabMemberType | "system";
export type CollabRoomRole = "owner" | "admin" | "member";

export type CollabRoom = {
  id: string;
  tenant_id: string;
  title: string;
  created_by: string;
  archived_at?: string;
  member_count: number;
  last_message_at?: string;
  last_seq: number;
  created_at: string;
  updated_at: string;
};

export type CollabRoomMember = {
  id: string;
  room_id: string;
  member_type: CollabMemberType;
  member_id: string;
  display_name: string;
  room_role: CollabRoomRole;
  joined_at: string;
  left_at?: string;
};

export type CollabRoomMessage = {
  id: string;
  room_id: string;
  tenant_id: string;
  seq: number;
  sender_type: CollabSenderType;
  sender_id: string;
  sender_name: string;
  content: string;
  model?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export class CollabRoomNotFoundError extends Error {
  public constructor(message = "room not found") {
    super(message);
    this.name = "CollabRoomNotFoundError";
  }
}

export class CollabRoomForbiddenError extends Error {
  public constructor(message = "not a room member") {
    super(message);
    this.name = "CollabRoomForbiddenError";
  }
}

export class CollabRoomBadRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CollabRoomBadRequestError";
  }
}

export interface CollabRoomStore {
  listRooms(ctx: CollabRoomContext): Promise<CollabRoom[]>;
  createRoom(ctx: CollabRoomContext, input: { title: string; displayName: string }): Promise<CollabRoom>;
  getRoom(ctx: CollabRoomContext, roomId: string): Promise<CollabRoom>;
  listMembers(ctx: CollabRoomContext, roomId: string): Promise<CollabRoomMember[]>;
  addHumanMember(
    ctx: CollabRoomContext,
    roomId: string,
    input: { userId: string; displayName: string; role?: CollabRoomRole },
  ): Promise<CollabRoomMember>;
  removeMember(ctx: CollabRoomContext, roomId: string, memberId: string): Promise<void>;
  leaveRoom(ctx: CollabRoomContext, roomId: string): Promise<void>;
  listMessages(
    ctx: CollabRoomContext,
    roomId: string,
    options?: { afterSeq?: number; limit?: number },
  ): Promise<CollabRoomMessage[]>;
  appendMessage(
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
  ): Promise<CollabRoomMessage>;
  resetForTests(): void | Promise<void>;
}
