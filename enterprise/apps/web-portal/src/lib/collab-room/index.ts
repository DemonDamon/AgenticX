import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { mysqlCollabRoomStore } from "./mysql";
import { postgresqlCollabRoomStore } from "./postgresql";
import type {
  CollabRoom,
  CollabRoomContext,
  CollabRoomMember,
  CollabRoomMessage,
  CollabRoomStore,
  CollabSenderType,
  CollabRoomRole,
} from "./types";

export {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
} from "./types";
export type {
  CollabMemberType,
  CollabRoom,
  CollabRoomContext,
  CollabRoomMember,
  CollabRoomMessage,
  CollabRoomRole,
  CollabRoomStore,
  CollabSenderType,
} from "./types";

function store(): CollabRoomStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return postgresqlCollabRoomStore;
    case "mysql":
      return mysqlCollabRoomStore;
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function listRooms(ctx: CollabRoomContext): Promise<CollabRoom[]> {
  return store().listRooms(ctx);
}

export function createRoom(
  ctx: CollabRoomContext,
  input: { title: string; displayName: string },
): Promise<CollabRoom> {
  return store().createRoom(ctx, input);
}

export function getRoom(ctx: CollabRoomContext, roomId: string): Promise<CollabRoom> {
  return store().getRoom(ctx, roomId);
}

export function listMembers(ctx: CollabRoomContext, roomId: string): Promise<CollabRoomMember[]> {
  return store().listMembers(ctx, roomId);
}

export function addHumanMember(
  ctx: CollabRoomContext,
  roomId: string,
  input: { userId: string; displayName: string; role?: CollabRoomRole },
): Promise<CollabRoomMember> {
  return store().addHumanMember(ctx, roomId, input);
}

export function removeMember(ctx: CollabRoomContext, roomId: string, memberId: string): Promise<void> {
  return store().removeMember(ctx, roomId, memberId);
}

export function leaveRoom(ctx: CollabRoomContext, roomId: string): Promise<void> {
  return store().leaveRoom(ctx, roomId);
}

export function listMessages(
  ctx: CollabRoomContext,
  roomId: string,
  options?: { afterSeq?: number; limit?: number },
): Promise<CollabRoomMessage[]> {
  return store().listMessages(ctx, roomId, options);
}

export function appendMessage(
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
  return store().appendMessage(ctx, roomId, input);
}

export function resetForTests(): void | Promise<void> {
  return store().resetForTests();
}
