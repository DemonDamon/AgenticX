import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { mysqlCollabRoomStore } from "./mysql";
import { postgresqlCollabRoomStore } from "./postgresql";
import type {
  CollabMergeMode,
  CollabMergeResult,
  CollabProject,
  CollabProjectRoom,
  CollabProjectSettings,
  CollabRoom,
  CollabRoomContext,
  CollabRoomMember,
  CollabRoomMessage,
  CollabRoomRole,
  CollabRoomStore,
  CollabSenderType,
} from "./types";

export {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
} from "./types";
export type {
  CollabMemberType,
  CollabMergeApplied,
  CollabMergeMode,
  CollabMergePending,
  CollabMergeResult,
  CollabProject,
  CollabProjectRoom,
  CollabProjectSettings,
  CollabRoom,
  CollabRoomContext,
  CollabRoomKind,
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

export function addAgentMember(
  ctx: CollabRoomContext,
  roomId: string,
  input: { agentId: string; displayName: string },
): Promise<CollabRoomMember> {
  return store().addAgentMember(ctx, roomId, input);
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
    clientMsgId?: string;
  },
): Promise<CollabRoomMessage> {
  return store().appendMessage(ctx, roomId, input);
}

export function findMessageByClientMsgId(
  ctx: CollabRoomContext,
  roomId: string,
  clientMsgId: string,
): Promise<CollabRoomMessage | null> {
  return store().findMessageByClientMsgId(ctx, roomId, clientMsgId);
}

export function createProject(
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
  return store().createProject(ctx, input);
}

export function listProjects(ctx: CollabRoomContext): Promise<CollabProject[]> {
  return store().listProjects(ctx);
}

export function getProject(ctx: CollabRoomContext, projectId: string): Promise<CollabProjectRoom> {
  return store().getProject(ctx, projectId);
}

export function addProjectMember(
  ctx: CollabRoomContext,
  projectId: string,
  input: { userId: string; displayName: string; role?: CollabRoomRole },
): Promise<CollabRoomMember> {
  return store().addProjectMember(ctx, projectId, input);
}

export function createSubRoom(
  ctx: CollabRoomContext,
  parentRoomId: string,
  input: {
    title: string;
    memberUserIds: Array<{ userId: string; displayName: string }>;
    agentIds?: string[];
    seedMessageIds?: string[];
  },
): Promise<CollabRoom> {
  return store().createSubRoom(ctx, parentRoomId, input);
}

export function openDirectRoom(
  ctx: CollabRoomContext,
  projectId: string,
  input: { peerUserId: string; peerDisplayName: string },
): Promise<CollabRoom> {
  return store().openDirectRoom(ctx, projectId, input);
}

export function mergeBack(
  ctx: CollabRoomContext,
  sourceRoomId: string,
  input: {
    targetRoomId: string;
    mode: CollabMergeMode;
    messageIds?: string[];
    summaryText?: string;
  },
): Promise<CollabMergeResult> {
  return store().mergeBack(ctx, sourceRoomId, input);
}

export function approveMerge(
  ctx: CollabRoomContext,
  sourceRoomId: string,
  mergeRequestSeq: number,
): Promise<CollabRoomMessage> {
  return store().approveMerge(ctx, sourceRoomId, mergeRequestSeq);
}

export function appendAgentMessageAsSystem(
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
  return store().appendAgentMessageAsSystem(tenantId, roomId, input);
}

export function resetForTests(): void | Promise<void> {
  return store().resetForTests();
}
