import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getQuotaSummaryForSession,
  getQuotaUsageForScope,
  resolveRuntimeGatewayDir,
  type QuotaConfigSnapshot,
} from "../quota-remaining";

describe("quota-remaining", () => {
  const prevEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-remaining-"));
    process.env.DEFAULT_TENANT_ID = "tenant-test";
    process.env.ENTERPRISE_GATEWAY_RUNTIME_DIR = tmpDir;
  });

  afterEach(() => {
    process.env = { ...prevEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unlimited when no monthlyTokens rule matches (AC-2)", async () => {
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: { staff: { monthlyTokens: 0, action: "warn" } }, model: {} },
      users: {},
      departments: {},
    };
    const usage = await getQuotaUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      deptId: "d1",
      role: "staff",
      configOverride: cfg,
    });
    expect(usage.unlimited).toBe(true);
    expect(usage.remaining).toBeNull();
  });

  it("computes remaining from local user usage file", async () => {
    const period = new Date();
    const month = `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
    fs.writeFileSync(
      path.join(tmpDir, "quota-usage.json"),
      JSON.stringify([{ user_id: "u1", month, used_total: 120_000 }]),
    );
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: { staff: { monthlyTokens: 500_000, action: "block" } }, model: {} },
      users: {},
      departments: {},
    };
    const usage = await getQuotaUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      role: "staff",
      configOverride: cfg,
    });
    expect(usage.used).toBe(120_000);
    expect(usage.limit).toBe(500_000);
    expect(usage.remaining).toBe(380_000);
    expect(usage.unlimited).toBe(false);
  });

  it("computes dept shared pool remaining (AC-1)", async () => {
    const period = new Date();
    const month = `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
    fs.writeFileSync(
      path.join(tmpDir, "quota-pool-usage.json"),
      JSON.stringify([
        {
          tenant_id: "tenant-test",
          scope_type: "dept",
          scope_id: "dept-a",
          period: month,
          used_total: 600_000,
        },
      ]),
    );
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: {}, model: {} },
      users: {},
      departments: {
        "dept-a": { monthlyTokens: 1_000_000, poolScope: "dept", action: "block" },
      },
    };
    const usage = await getQuotaUsageForScope({
      tenantId: "tenant-test",
      scope: "dept",
      scopeId: "dept-a",
      configOverride: cfg,
    });
    expect(usage.used).toBe(600_000);
    expect(usage.limit).toBe(1_000_000);
    expect(usage.remaining).toBe(400_000);
    expect(usage.shared).toBe(true);
  });

  it("portal summary only includes user and own dept (AC-3/AC-4)", async () => {
    const period = new Date();
    const month = `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
    fs.writeFileSync(
      path.join(tmpDir, "quota-usage.json"),
      JSON.stringify([{ user_id: "u-a", month, used_total: 10_000 }]),
    );
    fs.writeFileSync(
      path.join(tmpDir, "quota-pool-usage.json"),
      JSON.stringify([
        {
          tenant_id: "tenant-test",
          scope_type: "dept",
          scope_id: "dept-a",
          period: month,
          used_total: 600_000,
        },
      ]),
    );
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: { staff: { monthlyTokens: 500_000, action: "warn" } }, model: {} },
      users: {},
      departments: {
        "dept-a": { monthlyTokens: 1_000_000, poolScope: "dept", action: "block" },
      },
    };
    const summary = await getQuotaSummaryForSession({
      tenantId: "tenant-test",
      userId: "u-a",
      deptId: "dept-a",
      role: "staff",
      configOverride: cfg,
    });
    expect(summary.user.scopeId).toBe("u-a");
    expect(summary.dept?.scopeId).toBe("dept-a");
    expect(summary.dept?.used).toBe(600_000);
    expect(summary.dept?.remaining).toBe(400_000);
    expect(summary.unlimited).toBe(false);
  });

  it("resolveRuntimeGatewayDir honors env override", () => {
    process.env.ENTERPRISE_GATEWAY_RUNTIME_DIR = "/tmp/gateway-runtime";
    expect(resolveRuntimeGatewayDir()).toBe("/tmp/gateway-runtime");
  });
});
