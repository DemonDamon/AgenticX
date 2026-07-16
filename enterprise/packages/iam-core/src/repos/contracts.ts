import type { AuthUser } from "@agenticx/auth";
import type { DatabaseDialect } from "../database/config";
import type { IamDb } from "../db";
import type { AuditInsert } from "./audit";
import type {
  AdminUserDto,
  AdminUserStatus,
  ListUsersFilter,
  ListUsersResult,
  UpdateAdminUserInput,
} from "./users";
import type { DepartmentRow } from "./departments";
import type { RoleRow } from "./roles";
import type {
  SsoProviderDto,
  SsoProviderProtocol,
  SsoProviderSamlConfig,
} from "./sso-providers";

export interface DialectRepository {
  readonly dialect: DatabaseDialect;
}

export interface AuditRepository extends DialectRepository {
  insertAuditEvent(input: AuditInsert, dbOrTx?: IamDb): Promise<void>;
}

export interface UsersRepository extends DialectRepository {
  loadAuthUserByEmail(tenantId: string, email: string): Promise<AuthUser | null>;
  updateFailedLogin(tenantId: string, email: string, nextFailedCount: number, lockedUntilMs: number | null): Promise<void>;
  resetFailedLogin(tenantId: string, email: string): Promise<void>;
  listAdminUsers(tenantId: string, filter?: ListUsersFilter): Promise<ListUsersResult>;
  getAdminUser(tenantId: string, id: string): Promise<AdminUserDto | null>;
  createAdminUser(input: {
    tenantId: string; email: string; displayName: string; deptId?: string | null;
    status?: AdminUserStatus; phone?: string | null; employeeNo?: string | null;
    jobTitle?: string | null; roleCodes?: string[]; initialPassword?: string | null;
    defaultOrgId: string | null; actorUserId?: string | null;
  }): Promise<{ user: AdminUserDto; initialPassword: string }>;
  updateAdminUser(
    tenantId: string,
    id: string,
    patch: UpdateAdminUserInput,
    ctx: { actorUserId?: string | null; defaultOrgId: string | null },
  ): Promise<AdminUserDto>;
  softDeleteUser(tenantId: string, id: string, actorUserId?: string | null): Promise<void>;
  resetUserPassword(input: { tenantId: string; userId: string; actorUserId?: string | null }): Promise<{ initialPassword: string }>;
  upsertUserRowFromAuthUser(user: AuthUser): Promise<void>;
  assignRolesIfNone(input: {
    tenantId: string; userId: string; roleCodes: string[];
    defaultOrgId: string | null; defaultDeptId: string | null;
  }): Promise<void>;
  upsertUserByEmail(input: {
    tenantId: string; email: string; displayName: string; deptId: string | null;
    phone?: string | null; employeeNo?: string | null; jobTitle?: string | null;
    passwordHash: string; status?: AdminUserStatus; roleCodes: string[];
    defaultOrgId: string | null; actorUserId?: string | null;
  }): Promise<AdminUserDto>;
  replaceUserRoleAssignments(input: {
    tenantId: string; userId: string; roleCodes: string[];
    defaultOrgId: string | null; defaultDeptId: string | null;
  }): Promise<void>;
}

export interface DepartmentsRepository extends DialectRepository {
  getDefaultOrgId(tenantId: string): Promise<string | null>;
  listDepartmentsFlat(tenantId: string): Promise<DepartmentRow[]>;
  listDepartmentsTree(tenantId: string): Promise<DepartmentRow[]>;
  getDepartment(tenantId: string, id: string): Promise<DepartmentRow | null>;
  createDepartment(input: { tenantId: string; orgId: string; name: string; parentId?: string | null; actorUserId?: string | null }): Promise<DepartmentRow>;
  updateDepartmentName(input: { tenantId: string; id: string; name: string; actorUserId?: string | null }): Promise<DepartmentRow>;
  moveDepartment(input: { tenantId: string; id: string; newParentId: string | null; actorUserId?: string | null }): Promise<DepartmentRow>;
  deleteDepartment(input: { tenantId: string; id: string; actorUserId?: string | null }): Promise<void>;
  listDepartmentAncestorIds(tenantId: string, deptId: string): Promise<string[]>;
  listDepartmentSubtreeIds(tenantId: string, deptId: string): Promise<string[]>;
}

export interface RolesRepository extends DialectRepository {
  ensureSystemRoles(tenantId: string): Promise<void>;
  listRoles(tenantId: string): Promise<RoleRow[]>;
  getRoleById(tenantId: string, id: string): Promise<RoleRow | null>;
  getRoleByCode(tenantId: string, code: string): Promise<RoleRow | null>;
  createCustomRole(input: { tenantId: string; code: string; name: string; scopes: string[]; actorUserId?: string | null }): Promise<RoleRow>;
  updateRole(input: { tenantId: string; actorUserId?: string | null; id: string; name?: string; scopes?: string[] }): Promise<RoleRow>;
  deleteRole(input: { tenantId: string; id: string; actorUserId?: string | null }): Promise<void>;
  duplicateRole(input: { tenantId: string; sourceId: string; newCode: string; newName: string; actorUserId?: string | null }): Promise<RoleRow>;
  resolveRoleIdsFromCodes(tenantId: string, codes: string[], dbOrTx?: IamDb): Promise<Map<string, string>>;
  listUsersForRole(tenantId: string, roleId: string): Promise<Array<{ userId: string; email: string; displayName: string }>>;
  getUserRolesDetail(tenantId: string, userId: string): Promise<{ scopes: string[]; roleCodes: string[] }>;
}

export interface SsoProvidersRepository extends DialectRepository {
  listSsoProviders(tenantId: string): Promise<SsoProviderDto[]>;
  getSsoProviderByProviderId(tenantId: string, providerId: string): Promise<SsoProviderDto | null>;
  getSsoProviderById(tenantId: string, id: string): Promise<SsoProviderDto | null>;
  createSsoProvider(input: {
    tenantId: string; actorUserId?: string | null; providerId: string; displayName: string;
    protocol?: SsoProviderProtocol; issuer?: string | null; clientId?: string | null;
    clientSecretEncrypted?: string | null; redirectUri?: string | null; scopes?: string[];
    claimMapping?: Record<string, unknown>; samlConfig?: SsoProviderSamlConfig | null;
    defaultRoleCodes?: string[]; enabled?: boolean;
  }): Promise<SsoProviderDto>;
  updateSsoProvider(tenantId: string, id: string, patch: Partial<Omit<SsoProviderDto, "id" | "tenantId" | "providerId" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">>, actorUserId?: string | null): Promise<SsoProviderDto | null>;
  deleteSsoProvider(tenantId: string, id: string, actorUserId?: string | null): Promise<SsoProviderDto | null>;
}
