import type { PolicyRuleTestPreview } from "@agenticx/feature-policy";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { testPolicyRules } from "../../../../lib/policy-store";

export async function POST(req: Request) {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as {
    ruleIds?: string[];
    sampleText?: string;
    stage?: "request" | "response";
    preview?: PolicyRuleTestPreview;
    previewByRuleId?: Record<string, PolicyRuleTestPreview>;
  };
  const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.filter((id): id is string => typeof id === "string") : [];
  if (!ruleIds.length || typeof body.sampleText !== "string") {
    return NextResponse.json({ code: "40000", message: "ruleIds 与 sampleText 为必填项" }, { status: 400 });
  }
  let previewByRuleId: Record<string, PolicyRuleTestPreview> | undefined;
  if (body.previewByRuleId && typeof body.previewByRuleId === "object") {
    previewByRuleId = body.previewByRuleId;
  }
  const onlyRuleId = ruleIds.length === 1 ? ruleIds[0] : undefined;
  if (body.preview && typeof body.preview === "object" && onlyRuleId) {
    previewByRuleId = { ...(previewByRuleId ?? {}), [onlyRuleId]: body.preview };
  }
  try {
    const result = await testPolicyRules(guard.session.tenantId, {
      ruleIds,
      sampleText: body.sampleText,
      stage: body.stage,
      previewByRuleId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "规则测试失败" },
      { status: 400 }
    );
  }
}
