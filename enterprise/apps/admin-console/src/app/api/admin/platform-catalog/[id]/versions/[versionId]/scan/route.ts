import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../../../lib/admin-auth";
import { getCatalogItem, recordCatalogVersionScan } from "../../../../../../../../lib/platform-catalog-store";
import { scanSkillViaRegistry } from "../../../../../../../../lib/skill-registry-scan";

const VERDICTS = new Set(["safe", "caution", "dangerous"]);

export async function PUT(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { versionId } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;
  const verdict = typeof body.verdict === "string" ? body.verdict.trim() : "";
  if (!VERDICTS.has(verdict)) {
    return NextResponse.json({ code: "40001", message: "invalid verdict" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) {
    return NextResponse.json({ code: "40001", message: "source required" }, { status: 400 });
  }
  try {
    const version = await recordCatalogVersionScan(versionId, {
      verdict,
      source,
      findings: Array.isArray(body.findings) ? body.findings : [],
      scannedBy: auth.session.email || auth.session.userId || "",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { version } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "scan record failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id, versionId } = await context.params;
  try {
    const item = await getCatalogItem(id);
    if (!item) {
      return NextResponse.json({ code: "40400", message: "catalog item not found" }, { status: 404 });
    }
    const scanned = await scanSkillViaRegistry(item.slug);
    const version = await recordCatalogVersionScan(versionId, {
      verdict: scanned.verdict,
      source: scanned.source,
      findings: scanned.findings,
      scannedBy: auth.session.email || auth.session.userId || "",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { version } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "scan failed";
    const status = /SKILL_REGISTRY|skill-registry/i.test(message) ? 503 : 500;
    return NextResponse.json({ code: String(status * 100), message }, { status });
  }
}
