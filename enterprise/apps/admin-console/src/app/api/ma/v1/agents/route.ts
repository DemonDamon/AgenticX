import { NextResponse } from "next/server";
import {
  createAgentWithInitialVersion,
  listAgentsWithMa,
  type AgentLifecycle,
  type AgentRuntime,
  type AgentStatus,
} from "@agenticx/iam-core";

import { normalizeAssignmentKeys } from "../../../../../lib/capability-packs-store";
import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { toMaAgentEnvelope, toMaAgentVersionRecord } from "../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

const LIFECYCLES = ["draft", "published", "recalled"] as const;
const STATUSES = ["active", "disabled"] as const;
const CREATE_KEYS = [
  "slug",
  "display_name",
  "description",
  "runtime",
  "assignment_keys",
  "worker_keys",
  "manifest",
  "note",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFilter<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value == null || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new MaRequestError("invalid filter");
  return value as T;
}

function readRuntime(value: unknown): AgentRuntime {
  if (value === undefined) return "cloud";
  if (value === "cloud" || value === "desktop_worker") return value;
  throw new MaRequestError("runtime is invalid");
}

function readStringList(value: unknown, field: string, fallback: string[]): string[] {
  if (value === undefined) return normalizeAssignmentKeys(fallback);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MaRequestError(`${field} must be an array of strings`);
  }
  return normalizeAssignmentKeys(value);
}

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:agents:read");
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const lifecycle = readFilter<AgentLifecycle>(url.searchParams.get("lifecycle"), LIFECYCLES);
    const status = readFilter<AgentStatus>(url.searchParams.get("status"), STATUSES);
    const agents = await listAgentsWithMa(auth.identity.tenantId);
    const data = agents
      .filter((agent) => (lifecycle ? agent.lifecycle === lifecycle : true))
      .filter((agent) => (status ? agent.status === status : true))
      .map(toMaAgentEnvelope);
    return NextResponse.json({ data });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:agents:write");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, CREATE_KEYS);
    if (typeof body.slug !== "string" || !body.slug.trim()) throw new MaRequestError("slug is required");
    if (typeof body.display_name !== "string" || !body.display_name.trim()) {
      throw new MaRequestError("display_name is required");
    }
    if (!isRecord(body.manifest)) throw new MaRequestError("manifest is required");
    let description: string | null = null;
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new MaRequestError("description must be a string or null");
      }
      description = body.description;
    }
    let note: string | undefined;
    if ("note" in body && body.note != null) {
      if (typeof body.note !== "string") throw new MaRequestError("note must be a string");
      note = body.note;
    }
    const assignmentKeys = readStringList(body.assignment_keys, "assignment_keys", ["all"]);
    if (assignmentKeys.length === 0) throw new MaRequestError("assignment_keys is required");
    const workerKeys = readStringList(body.worker_keys, "worker_keys", []);
    const created = await createAgentWithInitialVersion(
      auth.identity.tenantId,
      {
        slug: body.slug.trim(),
        displayName: body.display_name.trim(),
        description,
        runtime: readRuntime(body.runtime),
        assignmentKeys,
        workerKeys,
        lifecycle: "draft",
        origin: "enterprise",
        model: "",
        systemPrompt: "",
      },
      {
        manifest: body.manifest,
        note,
        createdBy: auth.identity.userId,
        source: "api",
      },
    );
    return NextResponse.json(
      {
        ...toMaAgentEnvelope(created.agent),
        version: toMaAgentVersionRecord(created.version),
      },
      { status: 201 },
    );
  } catch (error) {
    return maErrorFromException(error);
  }
}
