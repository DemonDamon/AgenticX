/** Dialect-neutral DTOs — never derive public contracts from `$inferSelect`. */

export type Tenant = {
  id: string;
  code: string;
  name: string;
  plan: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type Department = {
  id: string;
  tenantId: string;
  orgId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type User = {
  id: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  status: string;
  isDeleted: boolean;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type Role = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  scopes: string[];
  immutable: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChatSession = {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  activeModel: string | null;
  messageCount: number;
  lastMessageAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  role: string;
  content: string;
  model: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  eventType: string;
  targetKind: string;
  targetId: string | null;
  detail: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type UsageRecord = {
  id: string;
  tenantId: string;
  deptId: string | null;
  userId: string | null;
  provider: string;
  model: string;
  route: string;
  inputTokens: number | string;
  outputTokens: number | string;
  totalTokens: number | string;
  costUsd: number | string;
  timeBucket: Date | string;
};

export type TenantDto = Tenant;
export type DepartmentDto = Department;
export type UserDto = User;
export type RoleDto = Role;
export type ChatSessionDto = ChatSession;
export type ChatMessageDto = ChatMessage;
export type AuditEventDto = AuditEvent;
export type UsageRecordDto = UsageRecord;
