import type { AuthContext } from "@agenticx/auth";
import { assertTenantScope } from "../middleware/rbac";
import {
  createUserSchema,
  type AuditEvent,
  type CreateUserInput,
  type IamUser,
  type ListUsersQuery,
  type UpdateUserInput,
  updateUserSchema,
} from "../types";

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type UserRepo = {
  users: Map<string, IamUser>;
  audits: AuditEvent[];
};

export class IamUserService {
  private readonly repo: UserRepo;

  public constructor(repo?: UserRepo) {
    this.repo = repo ?? { users: new Map<string, IamUser>(), audits: [] };
  }

  private recordAudit(event: Omit<AuditEvent, "id" | "createdAt">): void {
    this.repo.audits.push({
      id: makeId("audit"),
      createdAt: now(),
      ...event,
    });
  }

  public listAuditEvents(tenantId: string): AuditEvent[] {
    return this.repo.audits.filter((event) => event.tenantId === tenantId);
  }

  public async createUser(auth: AuthContext, input: CreateUserInput): Promise<IamUser> {
    const parsed = createUserSchema.parse(input);
    assertTenantScope(auth, parsed.tenantId, ["user:create"]);

    const emailKey = `${parsed.tenantId}:${parsed.email.toLowerCase()}`;
    const existed = this.repo.users.get(emailKey);
    if (existed && !existed.isDeleted) {
      throw new Error("User already exists.");
    }

    const user: IamUser = {
      id: makeId("user"),
      tenantId: parsed.tenantId,
      deptId: parsed.deptId ?? null,
      email: parsed.email.toLowerCase(),
      displayName: parsed.displayName,
      passwordHash: parsed.passwordHash,
      status: "active",
      isDeleted: false,
      createdAt: now(),
      updatedAt: now(),
    };

    this.repo.users.set(emailKey, user);
    this.recordAudit({
      tenantId: parsed.tenantId,
      actorUserId: auth.userId,
      eventType: "iam.user.create",
      targetUserId: user.id,
      detail: user.email,
    });
    return user;
  }

  public async listUsers(auth: AuthContext, query: ListUsersQuery = {}): Promise<{ total: number; items: IamUser[] }> {
    assertTenantScope(auth, auth.tenantId, ["user:read"]);
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 200);

    const tenantUsers = [...this.repo.users.values()].filter(
      (user) => user.tenantId === auth.tenantId && !user.isDeleted && (!query.deptId || user.deptId === query.deptId)
    );

    const start = (page - 1) * pageSize;
    return {
      total: tenantUsers.length,
      items: tenantUsers.slice(start, start + pageSize),
    };
  }

  public async updateUser(auth: AuthContext, userId: string, input: UpdateUserInput): Promise<IamUser> {
    const parsed = updateUserSchema.parse(input);
    assertTenantScope(auth, auth.tenantId, ["user:update"]);

    const target = [...this.repo.users.values()].find(
      (user) => user.id === userId && user.tenantId === auth.tenantId && !user.isDeleted
    );
    if (!target) throw new Error("User not found.");

    const updated: IamUser = {
      ...target,
      deptId: parsed.deptId === undefined ? target.deptId : parsed.deptId,
      displayName: parsed.displayName ?? target.displayName,
      status: parsed.status ?? target.status,
      updatedAt: now(),
    };

    this.repo.users.set(`${updated.tenantId}:${updated.email}`, updated);
    this.recordAudit({
      tenantId: updated.tenantId,
      actorUserId: auth.userId,
      eventType: "iam.user.update",
      targetUserId: updated.id,
    });
    return updated;
  }

  public async deleteUser(auth: AuthContext, userId: string): Promise<void> {
    assertTenantScope(auth, auth.tenantId, ["user:delete"]);
    const target = [...this.repo.users.values()].find(
      (user) => user.id === userId && user.tenantId === auth.tenantId && !user.isDeleted
    );
    if (!target) throw new Error("User not found.");
    const updated = { ...target, isDeleted: true, updatedAt: now() };
    this.repo.users.set(`${updated.tenantId}:${updated.email}`, updated);
    this.recordAudit({
      tenantId: updated.tenantId,
      actorUserId: auth.userId,
      eventType: "iam.user.delete",
      targetUserId: updated.id,
    });
  }

  public async enableUser(auth: AuthContext, userId: string): Promise<IamUser> {
    return this.setStatus(auth, userId, "active", "iam.user.enable");
  }

  public async disableUser(auth: AuthContext, userId: string): Promise<IamUser> {
    return this.setStatus(auth, userId, "disabled", "iam.user.disable");
  }

  public async resetPassword(auth: AuthContext, userId: string, nextPasswordHash: string): Promise<IamUser> {
    assertTenantScope(auth, auth.tenantId, ["user:update"]);
    const target = [...this.repo.users.values()].find(
      (user) => user.id === userId && user.tenantId === auth.tenantId && !user.isDeleted
    );
    if (!target) throw new Error("User not found.");

    const updated = {
      ...target,
      passwordHash: nextPasswordHash,
      updatedAt: now(),
    };
    this.repo.users.set(`${updated.tenantId}:${updated.email}`, updated);
    this.recordAudit({
      tenantId: updated.tenantId,
      actorUserId: auth.userId,
      eventType: "iam.user.reset_password",
      targetUserId: updated.id,
    });
    return updated;
  }

  private async setStatus(
    auth: AuthContext,
    userId: string,
    status: IamUser["status"],
    eventType: AuditEvent["eventType"]
  ): Promise<IamUser> {
    assertTenantScope(auth, auth.tenantId, ["user:update"]);
    const target = [...this.repo.users.values()].find(
      (user) => user.id === userId && user.tenantId === auth.tenantId && !user.isDeleted
    );
    if (!target) throw new Error("User not found.");
    const updated = { ...target, status, updatedAt: now() };
    this.repo.users.set(`${updated.tenantId}:${updated.email}`, updated);
    this.recordAudit({
      tenantId: updated.tenantId,
      actorUserId: auth.userId,
      eventType,
      targetUserId: updated.id,
    });
    return updated;
  }
}

