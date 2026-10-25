import { NextResponse } from "next/server";
import {
  createMaEnvironment,
  listMaEnvironments,
  type MaEnvironmentInput,
  type MaEnvironmentStatus,
  type MaEnvironmentType,
} from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { toMaEnvironmentRecord } from "../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

const TYPES = ["cloud", "desktop_worker"] as const;
const STATUSES = ["active", "disabled"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFilter<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value == null || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new MaRequestError("invalid filter");
  return value as T;
}

function readCreateInput(body: Record<string, unknown>): MaEnvironmentInput {
  if (typeof body.name !== "string" || !body.name.trim()) throw new MaRequestError("name is required");
  if (typeof body.type !== "string") throw new MaRequestError("type is required");
  if (body.type !== "cloud" && body.type !== "desktop_worker") throw new MaRequestError("type is invalid");
  const input: MaEnvironmentInput = { name: body.name, type: body.type };
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new MaRequestError("description must be a string or null");
    }
    input.description = body.description;
  }
  if ("config" in body) {
    if (!isRecord(body.config)) throw new MaRequestError("config must be an object");
    input.config = body.config;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "disabled") throw new MaRequestError("status is invalid");
    input.status = body.status;
  }
  return input;
}

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:environments:read");
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const type = readFilter<MaEnvironmentType>(url.searchParams.get("type"), TYPES);
    const status = readFilter<MaEnvironmentStatus>(url.searchParams.get("status"), STATUSES);
    const environments = await listMaEnvironments(auth.identity.tenantId, { type, status });
    return NextResponse.json({ data: environments.map(toMaEnvironmentRecord) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:environments:write");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["name", "type", "config", "description", "status"]);
    const environment = await createMaEnvironment(auth.identity.tenantId, readCreateInput(body), auth.identity.userId);
    return NextResponse.json({ environment: toMaEnvironmentRecord(environment) }, { status: 201 });
  } catch (error) {
    return maErrorFromException(error);
  }
}
