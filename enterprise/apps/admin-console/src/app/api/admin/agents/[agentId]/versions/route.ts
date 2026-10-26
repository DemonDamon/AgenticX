import { NextResponse } from "next/server";
import { createAgentVersion, getAgentWithMa, listAgentVersions, previewAgentManifest } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { emitMaResourceEvent } from "../../../../../../lib/ma/webhook-events";
import { agentErrorResponse, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalInt(raw: string | null): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const url = new URL(request.url);
    const tenantId = requiredTenantId();
    const versions = await listAgentVersions(tenantId, agentId, {
      limit: readOptionalInt(url.searchParams.get("limit")),
      beforeVersion: readOptionalInt(url.searchParams.get("beforeVersion")),
    });
    const agent = await getAgentWithMa(tenantId, agentId);
    return NextResponse.json({ code: "00000", message: "ok", data: { agent, versions } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const body = (await request.json().catch(() => null)) as unknown;
    const record = isJsonObject(body) ? body : {};
    if (!isJsonObject(record.manifest)) {
      return NextResponse.json({ code: "40000", message: "定义须为 JSON 对象" }, { status: 400 });
    }
    const tenantId = requiredTenantId();
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    if (dryRun) {
      const preview = await previewAgentManifest(tenantId, record.manifest);
      if (!preview.ok) {
        return NextResponse.json(
          { code: "40000", message: "定义校验未通过", data: { errorCode: "manifest_invalid", errors: preview.errors } },
          { status: 400 },
        );
      }
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: { ok: true, normalized: preview.normalized, manifestHash: preview.manifestHash },
      });
    }
    const expected = record.expectedLatestVersion;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) {
      return NextResponse.json({ code: "40000", message: "缺少当前版本号，请刷新后重试" }, { status: 400 });
    }
    let note: string | undefined;
    if (record.note !== undefined && record.note !== null) {
      if (typeof record.note !== "string") {
        return NextResponse.json({ code: "40000", message: "版本说明不合法" }, { status: 400 });
      }
      note = record.note;
    }
    const created = await createAgentVersion(tenantId, agentId, {
      manifest: record.manifest,
      expectedLatestVersion: expected,
      note,
      createdBy: auth.session.userId,
      source: "admin",
    });
    if (created.created) {
      emitMaResourceEvent({
        tenantId,
        type: "agent.version_published",
        resourceId: agentId,
        extra: { agent_id: agentId, version: created.version.version },
      });
    }
    const agent = await getAgentWithMa(tenantId, agentId);
    return NextResponse.json({
      code: "00000",
      message: created.created ? "ok" : "unchanged",
      data: { version: created.version, created: created.created, agent },
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
