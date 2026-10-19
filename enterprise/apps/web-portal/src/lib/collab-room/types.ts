export type CollabRoomContext = {
  tenantId: string;
  userId: string;
};

export type CollabMemberType = "human" | "meta" | "agent";
export type CollabSenderType = CollabMemberType | "system";
export type CollabRoomRole = "owner" | "admin" | "member";
export type CollabRoomKind = "room" | "main" | "sub" | "direct";
export type CollabMergeMode = "all" | "selected" | "summary";

export type CollabProjectSettings = {
  connectors: string[];
  experts: string[];
  skills: string[];
};

export type CollabProject = {
  id: string;
  tenant_id: string;
  name: string;
  instructions: string | null;
  owner_user_id: string;
  dept_id: string | null;
  main_room_id: string;
  settings: CollabProjectSettings;
  archived_at: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
};

export type CollabProjectRoom = {
  project: CollabProject;
  rooms: CollabRoom[];
};

export type CollabMergePending = {
  pending: true;
  request_seq: number;
};

export type CollabMergeApplied = {
  pending: false;
  message: CollabRoomMessage;
};

export type CollabMergeResult = CollabMergePending | CollabMergeApplied;

export type CollabRoom = {
  id: string;
  tenant_id: string;
  title: string;
  created_by: string;
  project_id: string | null;
  parent_room_id: string | null;
  room_kind: CollabRoomKind;
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
  client_msg_id: string | null;
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
  addAgentMember(
    ctx: CollabRoomContext,
    roomId: string,
    input: { agentId: string; displayName: string },
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
      clientMsgId?: string;
    },
  ): Promise<CollabRoomMessage>;
  createProject(
    ctx: CollabRoomContext,
    input: {
      name: string;
      instructions?: string;
      settings?: CollabProjectSettings;
      deptId?: string | null;
      displayName: string;
      memberUserIds?: Array<{ userId: string; displayName: string }>;
    },
  ): Promise<CollabProject>;
  listProjects(ctx: CollabRoomContext): Promise<CollabProject[]>;
  getProject(ctx: CollabRoomContext, projectId: string): Promise<CollabProjectRoom>;
  addProjectMember(
    ctx: CollabRoomContext,
    projectId: string,
    input: { userId: string; displayName: string; role?: CollabRoomRole },
  ): Promise<CollabRoomMember>;
  createSubRoom(
    ctx: CollabRoomContext,
    parentRoomId: string,
    input: {
      title: string;
      memberUserIds: Array<{ userId: string; displayName: string }>;
      agentIds?: string[];
      seedMessageIds?: string[];
    },
  ): Promise<CollabRoom>;
  openDirectRoom(
    ctx: CollabRoomContext,
    projectId: string,
    input: { peerUserId: string; peerDisplayName: string },
  ): Promise<CollabRoom>;
  mergeBack(
    ctx: CollabRoomContext,
    sourceRoomId: string,
    input: {
      targetRoomId: string;
      mode: CollabMergeMode;
      messageIds?: string[];
      summaryText?: string;
    },
  ): Promise<CollabMergeResult>;
  approveMerge(
    ctx: CollabRoomContext,
    sourceRoomId: string,
    mergeRequestSeq: number,
  ): Promise<CollabRoomMessage>;
  /** 服务端代写房间消息，不要求调用者是房间成员。 */
  appendAgentMessageAsSystem(
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
  ): Promise<CollabRoomMessage>;
  resetForTests(): void | Promise<void>;
}
