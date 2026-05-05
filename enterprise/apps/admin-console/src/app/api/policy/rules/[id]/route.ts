import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { buildPolicyActor, setPolicyRuleStatus, upsertPolicyRule } from "../../../../../lib/policy-store";

const ALLOWED_STATUSES = new Set(["draft", "active", "disabled"] as const);

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
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
  if (body.status !== undefined && !ALLOWED_STATUSES.has(body.status)) {
    return NextResponse.json({ code: "40000", message: "非法状态值" }, { status: 400 });
  }
  const isStatusOnlyPatch =
    body.status !== undefined &&
    body.packId === undefined &&
    body.code === undefined &&
    body.kind === undefined &&
    body.action === undefined &&
    body.severity === undefined &&
    body.message === undefined &&
    body.payload === undefined &&
    body.appliesTo === undefined;
  const { id } = await context.params;

  if (isStatusOnlyPatch) {
    const guard =
      body.status === "disabled"
        ? await requireAdminScope(["policy:disable"])
        : await requireAdminScope(["policy:update"]);
    if (!guard.ok) return guard.response;
    try {
      const actor = await buildPolicyActor(guard.session);
      await setPolicyRuleStatus(actor, id, body.status!);
      return NextResponse.json({ code: "00000", message: "ok" });
    } catch (error) {
      return NextResponse.json(
        { code: "40000", message: error instanceof Error ? error.message : "更新规则状态失败" },
        { status: 400 }
      );
    }
  }

  const updateGuard = await requireAdminScope(["policy:update"]);
  if (!updateGuard.ok) return updateGuard.response;
  if (body.status === "disabled") {
    const disableGuard = await requireAdminScope(["policy:disable"]);
    if (!disableGuard.ok) return disableGuard.response;
  }
  if (!body.packId || !body.code || !body.kind || !body.action || !body.severity || !body.payload) {
    return NextResponse.json({ code: "40000", message: "缺少必填字段" }, { status: 400 });
  }
  try {
    const actor = await buildPolicyActor(updateGuard.session);
    const rule = await upsertPolicyRule(actor, {
      id,
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
      { code: "40000", message: error instanceof Error ? error.message : "更新规则失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminScope(["policy:disable"]);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const actor = await buildPolicyActor(guard.session);
    await setPolicyRuleStatus(actor, id, "disabled");
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "停用规则失败" },
      { status: 400 }
    );
  }
}
