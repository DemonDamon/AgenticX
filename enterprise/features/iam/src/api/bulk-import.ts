import type { AuthContext } from "@agenticx/auth";
import { assertTenantScope } from "../middleware/rbac";
import { BulkImportService } from "../services/bulk-import";

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

export class IamBulkImportApi {
  private readonly service: BulkImportService;

  public constructor(service: BulkImportService) {
    this.service = service;
  }

  public template(auth: AuthContext) {
    assertTenantScope(auth, auth.tenantId, ["user:create"]);
    return ok({ csv: this.service.getTemplateCsv() });
  }

  public precheck(auth: AuthContext, csv: string) {
    assertTenantScope(auth, auth.tenantId, ["user:create"]);
    const failures = this.service.precheck(csv, auth.tenantId);
    return ok({ failures });
  }

  public async submit(auth: AuthContext, csv: string) {
    assertTenantScope(auth, auth.tenantId, ["user:create"]);
    const job = await this.service.submit(auth, csv);
    return ok(job);
  }

  public progress(auth: AuthContext, jobId: string) {
    assertTenantScope(auth, auth.tenantId, ["user:read"]);
    const job = this.service.getJob(jobId);
    if (!job || job.tenantId !== auth.tenantId) {
      return {
        code: "40404",
        message: "job not found",
      } as JsonResponse<never>;
    }
    return ok(job);
  }

  public async retry(auth: AuthContext, jobId: string) {
    assertTenantScope(auth, auth.tenantId, ["user:create"]);
    const job = await this.service.retryFailures(auth, jobId);
    return ok(job);
  }
}

