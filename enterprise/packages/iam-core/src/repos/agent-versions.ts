import { ulid } from "ulid";

import { AgentNotFoundError, AgentValidationError, listAgents } from "./agents";
import {
  AgentManifestInvalidError,
  AgentVersionConflictError,
  AgentVersionNotFoundError,
  ensureAgentVersionOneInTx,
  prepareManifestWithOps,
  toAgentVersion,
  type AgentVersion,
  type AgentVersionSource,
  type EnsureVersionOneResult,
} from "./agent-version-core";
import { deriveProjectionCapabilityIds } from "./agent-manifest-legacy";
import { withAgentVersionOps, withAgentVersionOpsNoTx } from "./agent-version-ops";

export {
  AgentManifestInvalidError,
  AgentVersionConflictError,
  AgentVersionNotFoundError,
  type AgentVersion,
  type AgentVersionSource,
  type EnsureVersionOneResult,
};

const NOTE_MAX = 500;

function normalizeNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  if (trimmed.length > NOTE_MAX) throw new AgentValidationError("版本说明不能超过 500 字");
  return trimmed;
}

function clampLimit(value: number | undefined, def: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return def;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

function isVersionUniqueConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (
      typeof coded.message === "string" &&
      /duplicate key|ER_DUP_ENTRY|enterprise_agent_versions_agent_version_uq|current transaction is aborted/i.test(
        coded.message,
      )
    ) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

/** 对外版：开事务 → lockAgent（不存在抛 AgentNotFoundError）→ ensureAgentVersionOneInTx。 */
export async function ensureAgentVersionOne(tenantId: string, agentId: string): Promise<EnsureVersionOneResult> {
  try {
    return await withAgentVersionOps(async (ops) => {
      const agent = await ops.lockAgent(tenantId, agentId);
      if (!agent) throw new AgentNotFoundError();
      return ensureAgentVersionOneInTx(ops, agent);
    });
  } catch (error) {
    if (!isVersionUniqueConflict(error)) throw error;
    return withAgentVersionOps(async (ops) => {
      if ((await ops.maxVersion(agentId)) > 0) return { status: "exists" };
      const agent = await ops.lockAgent(tenantId, agentId);
      if (!agent) throw new AgentNotFoundError();
      return ensureAgentVersionOneInTx(ops, agent);
    });
  }
}

export type CreateAgentVersionInput = {
  manifest: unknown;
  expectedLatestVersion: number;
  note?: string | null;
  createdBy?: string | null;
  source: Exclude<AgentVersionSource, "backfill" | "legacy_edit">;
};

export type CreateAgentVersionResult = { version: AgentVersion; created: boolean };

export async function createAgentVersion(
  tenantId: string,
  agentId: string,
  input: CreateAgentVersionInput,
): Promise<CreateAgentVersionResult> {
  const note = normalizeNote(input.note);
  if (!Number.isInteger(input.expectedLatestVersion) || input.expectedLatestVersion < 1) {
    throw new AgentValidationError("expectedLatestVersion 不合法");
  }
  return withAgentVersionOps(async (ops) => {
    const agent = await ops.lockAgent(tenantId, agentId);
    if (!agent) throw new AgentNotFoundError();
    await ensureAgentVersionOneInTx(ops, agent);
    const max = await ops.maxVersion(agentId);
    const current = max > 0 ? max : agent.latestVersion;
    if (input.expectedLatestVersion !== current) throw new AgentVersionConflictError(current);
    const prepared = await prepareManifestWithOps(ops, tenantId, input.manifest, { selfAgentId: agentId });
    if (!prepared.ok) throw new AgentManifestInvalidError(prepared.errors);
    if (max > 0) {
      const latest = await ops.findVersion(tenantId, agentId, max);
      if (latest && latest.manifestHash === prepared.manifestHash) {
        return { version: toAgentVersion(latest), created: false };
      }
    }
    const now = new Date();
    const newVersion = max > 0 ? max + 1 : 1;
    const row = {
      id: ulid(),
      tenantId,
      agentId,
      version: newVersion,
      manifest: prepared.normalized,
      manifestHash: prepared.manifestHash,
      note,
      source: input.source,
      createdBy: input.createdBy ?? null,
      createdAt: now.toISOString(),
    };
    await ops.insertVersion(row);
    await ops.setLatestVersion(
      tenantId,
      agentId,
      newVersion,
      {
        model: String(prepared.normalized.model ?? ""),
        systemPrompt: String(prepared.normalized.system ?? ""),
        capabilityIds: deriveProjectionCapabilityIds(prepared.normalized),
      },
      now,
    );
    return { version: toAgentVersion(row), created: true };
  });
}

/** 仅校验 + 固化 skill 版本，不写库（供 MA-E02 的 dry-run）。 */
export async function previewAgentManifest(
  tenantId: string,
  manifest: unknown,
  opts?: { selfAgentId?: string | null },
): Promise<
  { ok: true; normalized: Record<string, unknown>; manifestHash: string } | { ok: false; errors: string[] }
> {
  return withAgentVersionOpsNoTx((ops) => prepareManifestWithOps(ops, tenantId, manifest, opts));
}

export async function getAgentVersion(tenantId: string, agentId: string, version: number): Promise<AgentVersion> {
  await ensureAgentVersionOne(tenantId, agentId);
  return withAgentVersionOpsNoTx(async (ops) => {
    const row = await ops.findVersion(tenantId, agentId, version);
    if (!row) throw new AgentVersionNotFoundError();
    return toAgentVersion(row);
  });
}

export async function listAgentVersions(
  tenantId: string,
  agentId: string,
  opts?: { limit?: number; beforeVersion?: number },
): Promise<AgentVersion[]> {
  const limit = clampLimit(opts?.limit, 50, 200);
  await ensureAgentVersionOne(tenantId, agentId);
  return withAgentVersionOpsNoTx(async (ops) => {
    const rows = await ops.listVersions(tenantId, agentId, { limit, beforeVersion: opts?.beforeVersion });
    return rows.map(toAgentVersion);
  });
}

export type BackfillReport = {
  tenantId: string;
  created: number;
  exists: number;
  invalid: Array<{ agentId: string; slug: string; errors: string[] }>;
};

/** 遍历 listAgents(tenantId)，逐个 ensureAgentVersionOne（每个 Agent 一个事务）。 */
export async function backfillAgentVersions(tenantId: string): Promise<BackfillReport> {
  const agents = await listAgents(tenantId);
  const report: BackfillReport = { tenantId, created: 0, exists: 0, invalid: [] };
  for (const agent of agents) {
    const result = await ensureAgentVersionOne(tenantId, agent.id);
    switch (result.status) {
      case "created":
        report.created += 1;
        break;
      case "exists":
        report.exists += 1;
        break;
      case "invalid":
        report.invalid.push({ agentId: agent.id, slug: agent.slug, errors: result.errors });
        break;
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }
  return report;
}
