import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getSkill, recordSkillScan } from "../../../../../../lib/capability-packs-store";
import { scanSkillViaRegistry } from "../../../../../../lib/skill-registry-scan";

const VERDICTS = new Set(["safe", "caution", "dangerous"]);

/**
 * 记录一次扫描的结论。
 *
 * 单独一个端点而不是并进技能的 PATCH：扫描结论记录的是「某次扫描实际扫出了什么」，
 * 不是管理员可以随手改的字段。混进通用 PATCH 等于允许把 dangerous 手动改成 safe。
 *
 * PUT 接收已经扫好的 verdict（skill-registry 或离线 CLI）。
 * POST 现场调用已有 skill-registry，再把结论落库。
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
    return NextResponse.json({ code: "40001", message: "source is required" }, { status: 400 });
  }

  try {
    const skill = await recordSkillScan(id, {
      verdict,
      source,
      findings: Array.isArray(input.findings) ? input.findings : [],
      scannedBy: guard.session.email || guard.session.userId || "",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to record scan";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ code: String(status * 100), message }, { status });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;

  try {
    const existing = await getSkill(id);
    if (!existing) {
      return NextResponse.json({ code: "40400", message: "skill not found" }, { status: 404 });
    }
    const scanned = await scanSkillViaRegistry(existing.slug);
    const skill = await recordSkillScan(id, {
      verdict: scanned.verdict,
      source: scanned.source,
      findings: scanned.findings,
      scannedBy: guard.session.email || guard.session.userId || "",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to scan skill";
    const status = /not found/i.test(message) ? 404 : /SKILL_REGISTRY|skill-registry/i.test(message) ? 503 : 500;
    return NextResponse.json({ code: String(status * 100), message }, { status });
  }
}
