import { NextResponse } from "next/server";
import { getQuotaUsageForScope, type QuotaUsageScope } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../lib/admin-auth";

const SCOPES = new Set<QuotaUsageScope>(["tenant", "dept", "user", "pat"]);

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const scopeRaw = url.searchParams.get("scope")?.trim() ?? "";
  const scopeId = url.searchParams.get("id")?.trim() ?? "";

  if (!SCOPES.has(scopeRaw as QuotaUsageScope)) {
    return NextResponse.json(
      { code: "40001", message: "invalid scope; expected tenant|dept|user|pat" },
      { status: 400 },
    );
  }
  if (!scopeId) {
    return NextResponse.json({ code: "40001", message: "id is required" }, { status: 400 });
  }

  const scope = scopeRaw as QuotaUsageScope;
  const tenantId = guard.session.tenantId;
  const resolvedId = scope === "tenant" ? tenantId : scopeId;

  try {
    const usage = await getQuotaUsageForScope({
      tenantId,
      scope,
      scopeId: resolvedId,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
