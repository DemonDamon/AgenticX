import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { recordSkillScan } from "../../../../../../lib/capability-packs-store";

const VERDICTS = new Set(["safe", "caution", "dangerous"]);

/**
 * 记录一次扫描的结论。
 *
 * 单独一个端点而不是并进技能的 PATCH：扫描结论记录的是「某次扫描实际扫出了什么」，
 * 不是管理员可以随手改的字段。混进通用 PATCH 等于允许把 dangerous 手动改成 safe，
 * 而货架上点一下就发给全公司了。
 *
 * 结论从哪来这里不关心——skill-registry 服务扫出来的，或者管理员用 CLI 离线扫完贴进来的，
 * 都走这条。只要求写清 source（按什么可信度扫的）。
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ code: "40001", message: "invalid payload" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const verdict = typeof input.verdict === "string" ? input.verdict.trim() : "";
  if (!VERDICTS.has(verdict)) {
    return NextResponse.json(
      { code: "40001", message: "verdict must be safe, caution or dangerous" },
      { status: 400 },
    );
  }
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (!source) {
    // 不记来源的结论没法解释：同一个包按 community 和按 trusted 扫，放行判断不一样。
    return NextResponse.json({ code: "40001", message: "source is required" }, { status: 400 });
  }

  try {
    const skill = await recordSkillScan(id, {
      verdict,
      source,
      findings: Array.isArray(input.findings) ? input.findings : [],
      // 谁触发的由服务端从会话取，不信任请求体——否则留痕可以随便写别人的名字。
      scannedBy: guard.session.email || guard.session.userId || "",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to record scan";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ code: String(status * 100), message }, { status });
  }
}
