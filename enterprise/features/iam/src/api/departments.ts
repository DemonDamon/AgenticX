import type { AuthContext } from "@agenticx/auth";
import { DepartmentService } from "../services/department";
import type { UpsertDepartmentInput } from "../types";

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

export class IamDepartmentsApi {
  private readonly service: DepartmentService;

  public constructor(service: DepartmentService) {
    this.service = service;
  }

  public async createOrUpdate(auth: AuthContext, input: UpsertDepartmentInput) {
    const department = await this.service.upsert(auth, input);
    return ok(department);
  }

  public async remove(auth: AuthContext, tenantId: string, departmentId: string) {
    await this.service.remove(auth, tenantId, departmentId);
    return ok({ departmentId });
  }

  public async tree(auth: AuthContext, tenantId: string) {
    const tree = await this.service.listTree(auth, tenantId);
    return ok(tree);
  }
}

