/**
 * admin-console · in-memory 用户表
 *
 * 当前实现：进程内 Map（重启即丢）。
 *
 * 原因：
 *   - admin-console 和 web-portal 目前各自用内存仓库（见 web-portal/src/lib/auth-runtime.ts）
 *   - 为让 IAM users 页从 mock 升级到可写/可读，在 admin-console 自己建一个仓库
 *
 * TODO（下一轮）：
 *   - 替换为 drizzle 接 enterprise/packages/db-schema 的 `users` 表
 *   - 或者改为 HTTP 反向代理 web-portal 同名 API，避免双边不一致
 *
 * 接口契约：对外的 AdminUser 与 @agenticx/db-schema users 表字段对齐，
 * 以便未来无缝替换数据层。
 */

export type AdminUserStatus = "active" | "disabled" | "locked";

export interface AdminUser {
  id: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListUsersFilter {
  q?: string;
  status?: AdminUserStatus;
  deptId?: string;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  items: AdminUser[];
  total: number;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  deptId?: string | null;
  status?: AdminUserStatus;
  scopes?: string[];
  password?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  deptId?: string | null;
  status?: AdminUserStatus;
  scopes?: string[];
}

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? "tenant_default";
const DEFAULT_DEPT_ID = process.env.DEFAULT_DEPT_ID ?? null;
const DEFAULT_SCOPES = ["workspace:chat", "user:read"];

type Store = Map<string, AdminUser>;

declare global {
  var __agenticxAdminUsersStore: Store | undefined;
}

function now(): string {
  return new Date().toISOString();
}

function seed(store: Store): void {
  if (store.size > 0) return;
  const seeds: AdminUser[] = [
    {
      id: "u_001",
      tenantId: DEFAULT_TENANT_ID,
      deptId: DEFAULT_DEPT_ID,
      email: "owner@agenticx.local",
      displayName: "企业 Owner",
      status: "active",
      scopes: ["user:create", "user:read", "user:update", "user:delete", "role:read", "dept:read", "audit:read"],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "u_002",
      tenantId: DEFAULT_TENANT_ID,
      deptId: DEFAULT_DEPT_ID,
      email: "ops@agenticx.local",
      displayName: "运营管理员",
      status: "active",
      scopes: [...DEFAULT_SCOPES, "audit:read", "metering:read"],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "u_003",
      tenantId: DEFAULT_TENANT_ID,
      deptId: DEFAULT_DEPT_ID,
      email: "audit@agenticx.local",
      displayName: "审计员",
      status: "disabled",
      scopes: ["audit:read"],
      createdAt: now(),
      updatedAt: now(),
    },
  ];
  for (const user of seeds) store.set(user.id, user);
}

function getStore(): Store {
  if (!globalThis.__agenticxAdminUsersStore) {
    globalThis.__agenticxAdminUsersStore = new Map<string, AdminUser>();
    seed(globalThis.__agenticxAdminUsersStore);
  }
  return globalThis.__agenticxAdminUsersStore;
}

function generateId(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

export function listUsers(filter: ListUsersFilter = {}): ListUsersResult {
  const store = getStore();
  const all = Array.from(store.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filtered = all.filter((user) => {
    if (filter.status && user.status !== filter.status) return false;
    if (filter.deptId && user.deptId !== filter.deptId) return false;
    if (filter.q) {
      const needle = filter.q.toLowerCase();
      const hay = `${user.email} ${user.displayName} ${user.id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
}

export function getUser(id: string): AdminUser | null {
  return getStore().get(id) ?? null;
}

export function createUser(input: CreateUserInput): AdminUser {
  const store = getStore();
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("email is required");
  if (!input.displayName?.trim()) throw new Error("displayName is required");
  for (const existing of store.values()) {
    if (existing.email === email) throw new Error("email already exists");
  }
  const user: AdminUser = {
    id: generateId(),
    tenantId: DEFAULT_TENANT_ID,
    deptId: input.deptId ?? DEFAULT_DEPT_ID,
    email,
    displayName: input.displayName.trim(),
    status: input.status ?? "active",
    scopes: input.scopes ?? DEFAULT_SCOPES,
    createdAt: now(),
    updatedAt: now(),
  };
  store.set(user.id, user);
  return user;
}

export function updateUser(id: string, patch: UpdateUserInput): AdminUser {
  const store = getStore();
  const current = store.get(id);
  if (!current) throw new Error("user not found");
  const next: AdminUser = {
    ...current,
    displayName: patch.displayName?.trim() ?? current.displayName,
    deptId: patch.deptId === undefined ? current.deptId : patch.deptId,
    status: patch.status ?? current.status,
    scopes: patch.scopes ?? current.scopes,
    updatedAt: now(),
  };
  store.set(id, next);
  return next;
}

export function deleteUser(id: string): boolean {
  return getStore().delete(id);
}
