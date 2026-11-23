import { NextResponse } from "next/server";
import {
  readModerationConfig,
  readTenantModerationConfig,
  writeTenantModerationConfig,
  deleteTenantModerationConfig,
  type TenantModerationConfig,
} from "../../../../../lib/moderation-store";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { auditConsoleEvent } from "../../../../../lib/console-audit";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["audit:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  const tenantId = new URL(request.url).searchParams.get("tenant")?.trim();
  if (tenantId) {
    const tenant = await readTenantModerationConfig(tenantId);
    // 脱敏：apiKey 只回显是否已配置，PUT 原样带回时 store 侧保留旧值。
    const safe = tenant
      ? { ...tenant, provider: { ...tenant.provider, apiKey: tenant.provider.apiKey ? "******" : "" } }
      : tenant;
    return NextResponse.json({ code: "00000", message: "ok", data: safe });
  }
  const config = await readModerationConfig();
  // 脱敏：apiKey 不回显明文（只回显是否已配置）。
  const safe = Object.fromEntries(
    Object.entries(config.tenants).map(([tid, cfg]) => [
      tid,
      { ...cfg, provider: { ...cfg.provider, apiKey: cfg.provider.apiKey ? "******" : "" } },
    ]),
  );
  return NextResponse.json({ code: "00000", message: "ok", data: { tenants: safe } });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: { tenantId?: string; config?: TenantModerationConfig };
  try {
    body = (await request.json()) as { tenantId?: string; config?: TenantModerationConfig };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const tenantId = body.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "40001", message: "tenantId is required" }, { status: 400 });
  }
  if (!body.config) {
    return NextResponse.json({ code: "40001", message: "config is required" }, { status: 400 });
  }
  try {
    await writeTenantModerationConfig(tenantId, body.config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid config";
    return NextResponse.json({ code: "40001", message }, { status: 400 });
  }
  // 先审计后动作：配置变更留痕（apiKey 不入审计）。
  await auditConsoleEvent(guard.session, "moderation.config_updated", "moderation", {
    tenantId,
    enabled: body.config.enabled,
    mode: body.config.mode,
    providerType: body.config.provider.type,
    providerName: body.config.provider.name ?? null,
    providerUrl: body.config.provider.url,
    categories: body.config.categories ?? [],
    hasApiKey: Boolean(body.config.provider.apiKey),
  });
  // 网关 10s 内轮询到新配置，无需显式 reload。
  return NextResponse.json({ code: "00000", message: "ok", data: body.config });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminScope(["audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  const tenantId = new URL(request.url).searchParams.get("tenant")?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "40001", message: "tenant is required" }, { status: 400 });
  }
  await deleteTenantModerationConfig(tenantId);
  await auditConsoleEvent(guard.session, "moderation.config_deleted", "moderation", {
    tenantId,
  });
  return NextResponse.json({ code: "00000", message: "ok" });
}
