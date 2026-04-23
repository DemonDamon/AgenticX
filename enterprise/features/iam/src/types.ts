import { z } from "zod";

export const createUserSchema = z.object({
  tenantId: z.string().min(1),
  deptId: z.string().optional(),
  email: z.string().email(),
  displayName: z.string().min(1),
  passwordHash: z.string().min(20),
});

export const updateUserSchema = z.object({
  deptId: z.string().nullable().optional(),
  displayName: z.string().min(1).optional(),
  status: z.enum(["active", "disabled", "locked"]).optional(),
});

export type IamUser = {
  id: string;
  tenantId: string;
  deptId?: string | null;
  email: string;
  displayName: string;
  passwordHash: string;
  status: "active" | "disabled" | "locked";
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  actorUserId: string;
  eventType:
    | "iam.user.create"
    | "iam.user.update"
    | "iam.user.delete"
    | "iam.user.enable"
    | "iam.user.disable"
    | "iam.user.reset_password";
  targetUserId: string;
  detail?: string;
  createdAt: string;
};

export type ListUsersQuery = {
  deptId?: string;
  page?: number;
  pageSize?: number;
};

export const upsertDepartmentSchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1),
});

export type Department = {
  id: string;
  tenantId: string;
  parentId?: string | null;
  name: string;
  path: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DepartmentTreeNode = Department & {
  children: DepartmentTreeNode[];
};

export type UpsertDepartmentInput = z.infer<typeof upsertDepartmentSchema>;

export const scopeSchema = z.string().regex(/^[a-z_]+:[a-z_]+$/, "scope must follow resource:action");
export const roleSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(scopeSchema).min(1),
  immutable: z.boolean().default(false),
});

export type IamRole = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  scopes: string[];
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertRoleInput = z.infer<typeof roleSchema>;

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

