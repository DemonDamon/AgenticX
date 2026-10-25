import { NextResponse } from "next/server";
import {
  deleteMaEnvironment,
  getMaEnvironment,
  updateMaEnvironment,
  type MaEnvironmentInput,
} from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { toMaEnvironmentRecord } from "../../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPatch(body: Record<string, unknown>): Partial<MaEnvironmentInput> {
  const patch: Partial<MaEnvironmentInput> = {};
  if ("name" in body) {
    if (typeof body.name !== "string") throw new MaRequestError("name must be a string");
    patch.name = body.name;
  }
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new MaRequestError("description must be a string or null");
    }
    patch.description = body.description;
  }
  if ("config" in body) {
    if (!isRecord(body.config)) throw new MaRequestError("config must be an object");
    patch.config = body.config;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "disabled") throw new MaRequestError("status is invalid");
    patch.status = body.status;
  }
  if ("type" in body) {
    if (body.type !== "cloud" && body.type !== "desktop_worker") throw new MaRequestError("type is invalid");
    patch.type = body.type;
  }
  return patch;
}

export async function GET(request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireMaPat(request, "ma:environments:read");
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    if (!ULID_RE.test(envId)) return maError("environment_not_found", "environment not found");
    const environment = await getMaEnvironment(auth.identity.tenantId, envId);
    return NextResponse.json({ environment: toMaEnvironmentRecord(environment) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireMaPat(request, "ma:environments:write");
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    if (!ULID_RE.test(envId)) return maError("environment_not_found", "environment not found");
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["name", "config", "description", "status", "type"]);
    const environment = await updateMaEnvironment(auth.identity.tenantId, envId, readPatch(body));
    return NextResponse.json({ environment: toMaEnvironmentRecord(environment) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireMaPat(request, "ma:environments:write");
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    if (!ULID_RE.test(envId)) return maError("environment_not_found", "environment not found");
    await deleteMaEnvironment(auth.identity.tenantId, envId);
    return NextResponse.json({ id: envId, deleted: true });
  } catch (error) {
    return maErrorFromException(error);
  }
}
