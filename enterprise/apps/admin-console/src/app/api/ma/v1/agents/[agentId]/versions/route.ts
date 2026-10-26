import { NextResponse } from "next/server";
import { createAgentVersion, listAgentVersions } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { toMaAgentVersionRecord } from "../../../../../../../lib/ma/records";
import { emitMaResourceEvent } from "../../../../../../../lib/ma/webhook-events";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampLimit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 50;
  const truncated = Math.trunc(value);
  if (truncated < 1) return 1;
  if (truncated > 200) return 200;
  return truncated;
}

function readQueryInt(raw: string | null, field: string): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) throw new MaRequestError(`${field} is invalid`);
  return Number(raw);
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireMaPat(request, "ma:agents:read");
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    const url = new URL(request.url);
    const limit = clampLimit(readQueryInt(url.searchParams.get("limit"), "limit"));
    const beforeVersion = readQueryInt(url.searchParams.get("before_version"), "before_version");
    const versions = await listAgentVersions(auth.identity.tenantId, agentId, { limit, beforeVersion });
    const nextBeforeVersion = versions.length === limit ? Math.min(...versions.map((version) => version.version)) : null;
    return NextResponse.json({
      data: versions.map(toMaAgentVersionRecord),
      next_before_version: nextBeforeVersion,
    });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireMaPat(request, "ma:agents:write");
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["manifest", "expected_latest_version", "note"]);
    if (!isRecord(body.manifest)) throw new MaRequestError("manifest is required");
    const expected = body.expected_latest_version;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) {
      throw new MaRequestError("expected_latest_version is required");
    }
    let note: string | undefined;
    if ("note" in body && body.note != null) {
      if (typeof body.note !== "string") throw new MaRequestError("note must be a string");
      note = body.note;
    }
    const result = await createAgentVersion(auth.identity.tenantId, agentId, {
      manifest: body.manifest,
      expectedLatestVersion: expected,
      note,
      createdBy: auth.identity.userId,
      source: "api",
    });
    if (result.created) {
      emitMaResourceEvent({
        tenantId: auth.identity.tenantId,
        type: "agent.version_published",
        resourceId: agentId,
        extra: { agent_id: agentId, version: result.version.version },
      });
    }
    return NextResponse.json(
      { version: toMaAgentVersionRecord(result.version), created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return maErrorFromException(error);
  }
}
