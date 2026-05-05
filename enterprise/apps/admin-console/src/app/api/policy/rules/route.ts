import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { buildPolicyActor, listPolicyRules, upsertPolicyRule } from "../../../../lib/policy-store";

export async function GET(req: Request) {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const packCode = url.searchParams.get("packCode") || undefined;
  const kind = (url.searchParams.get("kind") || undefined) as "keyword" | "regex" | "pii" | undefined;
  const status = (url.searchParams.get("status") || undefined) as "draft" | "active" | "disabled" | undefined;
  const rules = await listPolicyRules(guard.session.tenantId, { packCode, kind, status });
  return NextResponse.json({ code: "00000", message: "ok", data: { rules } });
}

export async function POST(req: Request) {
  const guard = await requireAdminScope(["policy:create"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as {
    packId?: string;
    code?: string;
    kind?: "keyword" | "regex" | "pii";
    action?: "block" | "redact" | "warn";
    severity?: "low" | "medium" | "high" | "critical";
    message?: string | null;
    payload?: Record<string, unknown>;
    appliesTo?: Record<string, unknown> | null;
    status?: "draft" | "active" | "disabled";
  };
  if (!body.packId || !body.code || !body.kind || !body.action || !body.severity || !body.payload) {
    return NextResponse.json({ code: "40000", message: "缺少必填字段" }, { status: 400 });
  }
  try {
    const actor = await buildPolicyActor(guard.session);
    const rule = await upsertPolicyRule(actor, {
      packId: body.packId,
      code: body.code,
      kind: body.kind,
      action: body.action,
      severity: body.severity,
      message: body.message,
      payload: body.payload,
      appliesTo: body.appliesTo,
      status: body.status,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { rule } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "创建规则失败" },
      { status: 400 }
    );
  }
}
