import { NextResponse } from "next/server";
import {
  getAgentWithMa,
  updateAgent,
  updateAgentMaSettings,
  type AgentInput,
  type AgentLifecycle,
  type AgentMaSettingsPatch,
  type AgentRuntime,
  type AgentStatus,
} from "@agenticx/iam-core";

import { normalizeAssignmentKeys } from "../../../../../../lib/capability-packs-store";
import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { toMaAgentEnvelope } from "../../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

const MANIFEST_KEYS = ["manifest", "model", "system", "system_prompt", "capability_ids"] as const;
const PATCH_KEYS = [
  "display_name",
  "description",
  "status",
  "lifecycle",
  "runtime",
  "assignment_keys",
  "worker_keys",
  "default_environment_id",
  "routing",
] as const;

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new MaRequestError(`${field} is invalid`);
  }
  return value as T;
}

function readStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MaRequestError(`${field} must be an array of strings`);
  }
  return normalizeAssignmentKeys(value);
}

function readRouting(value: unknown): { versionRouting: "follow_latest" | "pinned"; pinnedVersion: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaRequestError("routing must be an object");
  const routing = value as Record<string, unknown>;
  assertOnlyKeys(routing, ["mode", "pinned_version"]);
  if (routing.mode !== "follow_latest" && routing.mode !== "pinned") throw new MaRequestError("routing.mode is invalid");
  if (routing.mode === "follow_latest") return { versionRouting: "follow_latest", pinnedVersion: null };
  if (typeof routing.pinned_version !== "number" || !Number.isInteger(routing.pinned_version) || routing.pinned_version < 1) {
    throw new MaRequestError("routing.pinned_version is invalid");
  }
  return { versionRouting: "pinned", pinnedVersion: routing.pinned_version };
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireMaPat(request, "ma:agents:read");
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    const agent = await getAgentWithMa(auth.identity.tenantId, agentId);
    return NextResponse.json(toMaAgentEnvelope(agent));
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireMaPat(request, "ma:agents:write");
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    const body = await readJsonObject(request);
    const blocked = MANIFEST_KEYS.find((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (blocked) {
      return maError("invalid_request", "use POST /ma/v1/agents/{id}/versions to change the manifest");
    }
    assertOnlyKeys(body, PATCH_KEYS);

    const basic: Partial<AgentInput> = {};
    let hasBasic = false;
    if ("display_name" in body) {
      if (typeof body.display_name !== "string") throw new MaRequestError("display_name must be a string");
      basic.displayName = body.display_name;
      hasBasic = true;
    }
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new MaRequestError("description must be a string or null");
      }
      basic.description = body.description;
      hasBasic = true;
    }
    if ("status" in body) {
      basic.status = readEnum<AgentStatus>(body.status, ["active", "disabled"], "status");
      hasBasic = true;
    }
    if ("lifecycle" in body) {
      basic.lifecycle = readEnum<AgentLifecycle>(body.lifecycle, ["draft", "published", "recalled"], "lifecycle");
      hasBasic = true;
    }
    if ("runtime" in body) {
      basic.runtime = readEnum<AgentRuntime>(body.runtime, ["cloud", "desktop_worker"], "runtime");
      hasBasic = true;
    }
    if ("assignment_keys" in body) {
      const keys = readStringList(body.assignment_keys, "assignment_keys");
      if (keys.length === 0) throw new MaRequestError("assignment_keys is required");
      basic.assignmentKeys = keys;
      hasBasic = true;
    }
    if ("worker_keys" in body) {
      basic.workerKeys = readStringList(body.worker_keys, "worker_keys");
      hasBasic = true;
    }

    const settings: AgentMaSettingsPatch = {};
    let hasSettings = false;
    if ("default_environment_id" in body) {
      if (body.default_environment_id !== null && typeof body.default_environment_id !== "string") {
        throw new MaRequestError("default_environment_id must be a string or null");
      }
      settings.defaultEnvironmentId =
        typeof body.default_environment_id === "string" && body.default_environment_id.trim() === ""
          ? null
          : body.default_environment_id;
      hasSettings = true;
    }
    if ("routing" in body) {
      const routing = readRouting(body.routing);
      settings.versionRouting = routing.versionRouting;
      settings.pinnedVersion = routing.pinnedVersion;
      hasSettings = true;
    }

    const tenantId = auth.identity.tenantId;
    if (hasBasic) await updateAgent(tenantId, agentId, basic);
    if (hasSettings) await updateAgentMaSettings(tenantId, agentId, settings);
    const agent = await getAgentWithMa(tenantId, agentId);
    return NextResponse.json(toMaAgentEnvelope(agent));
  } catch (error) {
    return maErrorFromException(error);
  }
}
