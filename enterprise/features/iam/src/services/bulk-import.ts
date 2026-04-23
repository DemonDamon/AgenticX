import type { AuthContext } from "@agenticx/auth";
import { z } from "zod";
import { IamUserService } from "./user";

const csvRowSchema = z.object({
  tenantId: z.string().min(1),
  deptId: z.string().optional(),
  email: z.string().email(),
  displayName: z.string().min(1),
  passwordHash: z.string().min(20),
});

type CsvRow = z.infer<typeof csvRowSchema>;
type ParsedCsv = {
  rows: Array<CsvRow & { rowIndex: number }>;
  failures: ImportFailure[];
};

export type ImportFailure = {
  rowIndex: number;
  email: string;
  reason: string;
};

export type ImportJob = {
  id: string;
  tenantId: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  success: number;
  failed: number;
  failures: ImportFailure[];
  createdAt: string;
  updatedAt: string;
};

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class BulkImportService {
  private readonly jobs = new Map<string, ImportJob>();
  private readonly sourceRows = new Map<string, Array<CsvRow & { rowIndex: number }>>();
  private readonly userService: IamUserService;

  public constructor(userService: IamUserService) {
    this.userService = userService;
  }

  public getTemplateCsv(): string {
    return "email,display_name,dept_id,password_hash\nuser@example.com,Alice,dept-001,$2b$12$exampleexampleexampleexampleexample";
  }

  public precheck(csv: string, tenantId: string): ImportFailure[] {
    const parsed = this.parseWithValidation(csv, tenantId);
    const failures: ImportFailure[] = [...parsed.failures];
    const rows = parsed.rows;
    const seen = new Set<string>();
    rows.forEach((row) => {
      const email = row.email.toLowerCase();
      if (seen.has(email)) {
        failures.push({
          rowIndex: row.rowIndex,
          email,
          reason: "Duplicate email in CSV.",
        });
      }
      seen.add(email);
    });
    return failures;
  }

  public async submit(auth: AuthContext, csv: string): Promise<ImportJob> {
    const tenantId = auth.tenantId;
    const parsed = this.parseWithValidation(csv, tenantId);
    const precheckFailures = this.precheck(csv, tenantId);
    const invalidRows = new Set(precheckFailures.map((item) => item.rowIndex));
    const rows = parsed.rows.filter((row) => !invalidRows.has(row.rowIndex));

    const job: ImportJob = {
      id: makeId("job"),
      tenantId,
      status: "queued",
      total: parsed.rows.length,
      success: 0,
      failed: precheckFailures.length,
      failures: [...precheckFailures],
      createdAt: now(),
      updatedAt: now(),
    };

    this.jobs.set(job.id, job);
    this.sourceRows.set(job.id, rows);
    await this.runJob(auth, job.id, rows);
    return this.jobs.get(job.id)!;
  }

  public getJob(jobId: string): ImportJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  public async retryFailures(auth: AuthContext, jobId: string): Promise<ImportJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Job not found.");

    const originalRows = this.sourceRows.get(jobId) ?? [];
    const retryRowIndexes = new Set(job.failures.map((failure) => failure.rowIndex));
    const rows = originalRows.filter((row) => retryRowIndexes.has(row.rowIndex));

    job.failed = 0;
    job.failures = [];
    this.jobs.set(jobId, job);

    await this.runJob(auth, jobId, rows);
    return this.jobs.get(jobId)!;
  }

  private parseWithValidation(csv: string, tenantId: string): ParsedCsv {
    const failures: ImportFailure[] = [];
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return { rows: [], failures };
    const headerLine = lines[0];
    if (!headerLine) return { rows: [], failures };
    const headers = headerLine.split(",").map((item) => item.trim());
    const rows: Array<CsvRow & { rowIndex: number }> = [];

    lines.slice(1).forEach((line, index) => {
      const rowIndex = index + 2;
      const values = line.split(",").map((item) => item.trim());
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
      const parsed = csvRowSchema.safeParse({
        tenantId,
        deptId: row.dept_id || undefined,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
      });

      if (!parsed.success) {
        failures.push({
          rowIndex,
          email: String(row.email ?? "").toLowerCase(),
          reason: parsed.error.issues[0]?.message ?? "Invalid CSV row.",
        });
        return;
      }
      rows.push({ ...parsed.data, rowIndex });
    });

    return { rows, failures };
  }

  private async runJob(auth: AuthContext, jobId: string, rows: Array<CsvRow & { rowIndex: number }>): Promise<void> {
    const current = this.jobs.get(jobId);
    if (!current) return;

    current.status = "running";
    current.updatedAt = now();
    this.jobs.set(jobId, current);

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const createdUserIds: string[] = [];
      let shouldRollbackBatch = false;

      for (const row of batch) {
        if (shouldRollbackBatch) break;
          try {
            const created = await this.userService.createUser(auth, {
              tenantId: row.tenantId,
              deptId: row.deptId,
              email: row.email,
              displayName: row.displayName,
              passwordHash: row.passwordHash,
            });
            createdUserIds.push(created.id);
            current.success += 1;
          } catch (error) {
            current.failed += 1;
            current.failures.push({
              rowIndex: row.rowIndex,
              email: row.email,
              reason: error instanceof Error ? error.message : "Unknown import error",
            });
            shouldRollbackBatch = true;
          }
      }

      // 批事务语义：单批次出现失败，则回滚同批次已创建的账号，便于后续 retry。
      if (shouldRollbackBatch && createdUserIds.length > 0) {
        await Promise.all(
          createdUserIds.map(async (userId) => {
            try {
              await this.userService.deleteUser(auth, userId);
              current.success = Math.max(0, current.success - 1);
            } catch {
              // 回滚失败时保留失败记录，避免静默数据不一致。
            }
          })
        );
      }

      current.updatedAt = now();
      this.jobs.set(jobId, current);
    }

    current.status = current.failed > 0 ? "failed" : "completed";
    current.updatedAt = now();
    this.jobs.set(jobId, current);
  }
}

