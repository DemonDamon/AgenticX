import type { AuthContext } from "@agenticx/auth";
import { RoleService } from "../services/role";
import type { UpsertRoleInput } from "../types";

type JsonResponse<T> = {
  code: string;
  message: string;
  data?: T;
};

function ok<T>(data: T): JsonResponse<T> {
  return {
    code: "00000",
    message: "ok",
    data,
  };
}

export class IamRolesApi {
  private readonly service: RoleService;

  public constructor(service: RoleService) {
    this.service = service;
  }

  public async bootstrapSystemRoles(tenantId: string) {
    const roles = await this.service.bootstrapSystemRoles(tenantId);
    return ok(roles);
  }

  public async upsert(auth: AuthContext, input: UpsertRoleInput) {
    const role = await this.service.upsertRole(auth, input);
    return ok(role);
  }

  public async list(auth: AuthContext) {
    const roles = await this.service.listRoles(auth);
    return ok(roles);
  }

  public async bind(auth: AuthContext, userId: string, roleId: string) {
    await this.service.bindRole(auth, userId, roleId);
    return ok({ userId, roleId });
  }

  public async unbind(auth: AuthContext, userId: string, roleId: string) {
    await this.service.unbindRole(auth, userId, roleId);
    return ok({ userId, roleId });
  }
}

