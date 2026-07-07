import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getQuotaSummaryForSession,
  getQuotaWindowUsageForScope,
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

  it("supports day/week/month windows independently", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const week = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;

    fs.writeFileSync(
      path.join(tmpDir, "quota-usage.json"),
      JSON.stringify([{ user_id: "u1", month, used_total: 700 }]),
    );
    fs.writeFileSync(
      path.join(tmpDir, "quota-pool-usage.json"),
      JSON.stringify([
        { tenant_id: "tenant-test", scope_type: "tok_day", scope_id: "user::u1", period: day, used_total: 100 },
        { tenant_id: "tenant-test", scope_type: "tok_week", scope_id: "user::u1", period: week, used_total: 300 },
      ]),
    );

    const cfg: QuotaConfigSnapshot = {
      defaults: { role: { staff: { dailyTokens: 200, weeklyTokens: 500, monthlyTokens: 1000 } }, model: {} },
      users: {},
      departments: {},
    };

    const daily = await getQuotaWindowUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      role: "staff",
      window: "day",
      configOverride: cfg,
    });
    const weekly = await getQuotaWindowUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      role: "staff",
      window: "week",
      configOverride: cfg,
    });
    const monthly = await getQuotaWindowUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      role: "staff",
      window: "month",
      configOverride: cfg,
    });

    expect(daily.used).toBe(100);
    expect(daily.limit).toBe(200);
    expect(daily.remaining).toBe(100);

    expect(weekly.used).toBe(300);
    expect(weekly.limit).toBe(500);
    expect(weekly.remaining).toBe(200);

    expect(monthly.used).toBe(700);
    expect(monthly.limit).toBe(1000);
    expect(monthly.remaining).toBe(300);
  });

  it("dept scope day window used stays 0 (gateway tracks per identity, not dept pool)", async () => {
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(tmpDir, "quota-pool-usage.json"),
      JSON.stringify([
        {
          tenant_id: "tenant-test",
          scope_type: "tok_day",
          scope_id: "dept::dept-a",
          period: day,
          used_total: 999,
        },
        {
          tenant_id: "tenant-test",
          scope_type: "tok_day",
          scope_id: "user::u1",
          period: day,
          used_total: 50,
        },
      ]),
    );
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: {}, model: {} },
      users: {},
      departments: {
        "dept-a": { dailyTokens: 200, monthlyTokens: 1000, poolScope: "dept" },
      },
    };
    const daily = await getQuotaWindowUsageForScope({
      tenantId: "tenant-test",
      scope: "dept",
      scopeId: "dept-a",
      window: "day",
      configOverride: cfg,
    });
    expect(daily.limit).toBe(200);
    expect(daily.used).toBe(0);
  });

  it("returns unlimited for day window when dailyTokens is unset", async () => {
    const cfg: QuotaConfigSnapshot = {
      defaults: { role: { staff: { monthlyTokens: 1000 } }, model: {} },
      users: {},
      departments: {},
    };
    const daily = await getQuotaWindowUsageForScope({
      tenantId: "tenant-test",
      scope: "user",
      scopeId: "u1",
      role: "staff",
      window: "day",
      configOverride: cfg,
    });
    expect(daily.unlimited).toBe(true);
  });
});
