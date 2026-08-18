import {
  isAssignableFeature,
  listFeatureAssignments,
  replaceFeatureAssignments,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";

function migrationHint(message: string): string {
  return /enterprise_feature_assignments|relation .* does not exist/i.test(message)
    ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
    : message;
}

export async function GET(_req: Request, context: { params: Promise<{ feature: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { feature } = await context.params;
  if (!isAssignableFeature(feature)) {
    return NextResponse.json({ code: "40000", message: "unknown feature" }, { status: 400 });
  }
  try {
    const assignmentKeys = await listFeatureAssignments(auth.session.tenantId, feature);
    return NextResponse.json({ code: "00000", message: "ok", data: { feature, assignmentKeys } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load assignments";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ feature: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { feature } = await context.params;
  if (!isAssignableFeature(feature)) {
    return NextResponse.json({ code: "40000", message: "unknown feature" }, { status: 400 });
  }
  try {
    const body = (await request.json()) as { assignmentKeys?: unknown };
    const keys = Array.isArray(body.assignmentKeys)
      ? body.assignmentKeys.filter((key): key is string => typeof key === "string")
      : [];
    // 整体替换而非增删：让前端 diff 两个集合再发细粒度调用，正是「只改了一半」的成因。
    const assignmentKeys = await replaceFeatureAssignments(auth.session.tenantId, feature, keys);
    return NextResponse.json({ code: "00000", message: "ok", data: { feature, assignmentKeys } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "update failed" },
      { status: 400 },
    );
  }
}
