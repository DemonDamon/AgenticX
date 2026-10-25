import { validateManifest } from "@agenticx/core-api";
import { afterEach, describe, expect, it } from "vitest";

import { buildLegacyManifest, deriveProjectionCapabilityIds } from "../agent-manifest-legacy";
import { updateAgentWithLegacyVersion } from "../agent-version-core";
import {
  __setAgentVersionOpsForTests,
  createMemoryAgentVersionOps,
  type AgentVersionRowLike,
  type LockedAgentRow,
  type MemoryAgentVersionState,
} from "../agent-version-ops";
import {
  AgentManifestInvalidError,
  AgentVersionConflictError,
  createAgentVersion,
  ensureAgentVersionOne,
  listAgentVersions,
  previewAgentManifest,
} from "../agent-versions";
import { isForeignKeyViolation, resolveEffectiveVersion, updateAgentMaSettings } from "../agents";

const TENANT = "01TENANT00000000000000001A";
const AGENT = "01AGENT000000000000000001A";
const SKILL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function agent(patch: Partial<LockedAgentRow> = {}): LockedAgentRow {
  return {
    id: AGENT,
    tenantId: TENANT,
    model: "openai/gpt-4o",
    systemPrompt: "hello",
    capabilityIds: [],
    metadata: {},
    runtime: "cloud",
    latestVersion: 1,
    versionRouting: "follow_latest",
    pinnedVersion: null,
    defaultEnvironmentId: null,
    ...patch,
  };
}

function useState(patch: Partial<LockedAgentRow> = {}): MemoryAgentVersionState {
  const state: MemoryAgentVersionState = {
    agents: [agent(patch)],
    versions: [],
    skills: [],
    environments: [],
  };
  __setAgentVersionOpsForTests(createMemoryAgentVersionOps(state));
  return state;
}

afterEach(() => {
  __setAgentVersionOpsForTests(null);
});

describe("agent versions", () => {
  it("ensureAgentVersionOne creates v1 from legacy columns", async () => {
    const state = useState();
    const result = await ensureAgentVersionOne(TENANT, AGENT);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.version.version).toBe(1);
    expect(result.version.source).toBe("backfill");
    expect(result.version.manifestHash.startsWith("sha256:")).toBe(true);
    const validated = validateManifest(buildLegacyManifest(state.agents[0]!, new Map()));
    expect(result.version.manifestHash).toBe(validated.manifestHash);
  });

  it("ensureAgentVersionOne is idempotent", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const second = await ensureAgentVersionOne(TENANT, AGENT);
    expect(second.status).toBe("exists");
    expect(state.versions).toHaveLength(1);
  });

  it("ensureAgentVersionOne reports invalid legacy model", async () => {
    const state = useState({ model: "gpt-4o" });
    const result = await ensureAgentVersionOne(TENANT, AGENT);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors).toContain('manifest.model: must be "<providerId>/<modelName>"');
    expect(state.versions).toHaveLength(0);
  });

  it("createAgentVersion appends v2 after implicit v1 and updates projection", async () => {
    const state = useState();
    const result = await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: { schema: "agx.agent/v1", model: "openai/gpt-4.1", system: "new prompt" },
    });
    expect(result.created).toBe(true);
    expect(result.version.version).toBe(2);
    expect(state.agents[0]?.latestVersion).toBe(2);
    expect(state.agents[0]?.model).toBe("openai/gpt-4.1");
    expect(state.agents[0]?.systemPrompt).toBe("new prompt");
    expect(state.agents[0]?.capabilityIds).toEqual(deriveProjectionCapabilityIds(result.version.manifest));
  });

  it("createAgentVersion rejects stale expectedLatestVersion", async () => {
    const state = useState();
    await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: { schema: "agx.agent/v1", model: "openai/gpt-4.1", system: "v2" },
    });
    const before = state.versions.length;
    await expect(
      createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: { schema: "agx.agent/v1", model: "openai/gpt-4.2", system: "v3" },
      }),
    ).rejects.toBeInstanceOf(AgentVersionConflictError);
    try {
      await createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: { schema: "agx.agent/v1", model: "openai/gpt-4.2", system: "v3" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AgentVersionConflictError);
      expect((error as AgentVersionConflictError).currentLatestVersion).toBe(2);
    }
    expect(state.versions).toHaveLength(before);
  });

  it("createAgentVersion rejects invalid manifest atomically", async () => {
    const state = useState();
    const beforeModel = state.agents[0]?.model;
    try {
      await createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "api",
        manifest: { schema: "agx.agent/v1" },
      });
      throw new Error("expected invalid manifest");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentManifestInvalidError);
      expect((error as AgentManifestInvalidError).errors).toContain("manifest.model: is required");
    }
    expect(state.versions).toHaveLength(0);
    expect(state.agents[0]?.model).toBe(beforeModel);
    expect(state.agents[0]?.latestVersion).toBe(1);
  });

  it("createAgentVersion returns created=false when hash unchanged", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const result = await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: {
        schema: "agx.agent/v1",
        model: "openai/gpt-4o",
        system: "hello",
        tools: [],
        mcp_servers: [],
        skills: [],
        multiagent: null,
        runtime: { max_tool_rounds: 40, max_session_tokens: null },
        metadata: {},
      },
    });
    expect(result.created).toBe(false);
    expect(result.version.version).toBe(1);
    expect(state.versions).toHaveLength(1);
  });

  it("createAgentVersion pins tenant skill version", async () => {
    const state = useState();
    state.skills.push({ tenantId: TENANT, id: SKILL_ID, version: "1.2.0" });
    const result = await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "desktop",
      manifest: {
        schema: "agx.agent/v1",
        model: "openai/gpt-4o",
        system: "with skill",
        skills: [{ source: "tenant", id: SKILL_ID }],
      },
    });
    const skills = result.version.manifest.skills as Array<{ version: string }>;
    expect(skills[0]?.version).toBe("1.2.0");
  });

  it("createAgentVersion writes v1 when legacy cannot be backfilled", async () => {
    const state = useState({ model: "gpt-4o" });
    const result = await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: { schema: "agx.agent/v1", model: "openai/gpt-4o", system: "repaired" },
    });
    expect(result.created).toBe(true);
    expect(result.version.version).toBe(1);
    expect(state.versions).toHaveLength(1);
    expect(state.agents[0]?.model).toBe("openai/gpt-4o");
  });

  it("listAgentVersions returns descending order and honours beforeVersion", async () => {
    useState();
    await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: { schema: "agx.agent/v1", model: "openai/gpt-4.1", system: "v2" },
    });
    const all = await listAgentVersions(TENANT, AGENT);
    expect(all.map((row) => row.version)).toEqual([2, 1]);
    const older = await listAgentVersions(TENANT, AGENT, { beforeVersion: 2 });
    expect(older.map((row) => row.version)).toEqual([1]);
  });

  it("module exports no version update or delete function", async () => {
    const mod = await import("../agent-versions");
    expect(Object.keys(mod).some((key) => /^(update|delete|remove)AgentVersion/.test(key))).toBe(false);
  });

  it("legacy edit appends a legacy_edit version when versions exist", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const outcome = await updateAgentWithLegacyVersion(
      createMemoryAgentVersionOps(state),
      TENANT,
      AGENT,
      { model: "openai/gpt-4.1", systemPrompt: "hello", capabilityIds: [], metadata: {}, updatedAt: new Date() },
      { model: "openai/gpt-4.1", systemPrompt: "hello", capabilityIds: [], metadata: {} },
      false,
    );
    expect(outcome).toBe("versioned");
    expect(state.versions).toHaveLength(2);
    expect(state.versions[1]?.source).toBe("legacy_edit");
  });

  it("legacy edit without manifest field changes does not create a version", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const outcome = await updateAgentWithLegacyVersion(
      createMemoryAgentVersionOps(state),
      TENANT,
      AGENT,
      { model: "openai/gpt-4o", systemPrompt: "hello", capabilityIds: [], metadata: {}, updatedAt: new Date() },
      { model: "openai/gpt-4o", systemPrompt: "hello", capabilityIds: [], metadata: {} },
      false,
    );
    expect(outcome).toBe("updated");
    expect(state.versions).toHaveLength(1);
  });

  it("legacy edit on agent without versions only updates columns", async () => {
    const state = useState();
    const outcome = await updateAgentWithLegacyVersion(
      createMemoryAgentVersionOps(state),
      TENANT,
      AGENT,
      { model: "openai/gpt-4.1", systemPrompt: "hello", capabilityIds: [], metadata: {}, updatedAt: new Date() },
      { model: "openai/gpt-4.1", systemPrompt: "hello", capabilityIds: [], metadata: {} },
      false,
    );
    expect(outcome).toBe("updated");
    expect(state.versions).toHaveLength(0);
    expect(state.agents[0]?.model).toBe("openai/gpt-4.1");
  });

  it("legacy edit with invalid model skips version and keeps columns updated", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const outcome = await updateAgentWithLegacyVersion(
      createMemoryAgentVersionOps(state),
      TENANT,
      AGENT,
      { model: "gpt-4o", systemPrompt: "hello", capabilityIds: [], metadata: {}, updatedAt: new Date() },
      { model: "gpt-4o", systemPrompt: "hello", capabilityIds: [], metadata: {} },
      false,
    );
    expect(outcome).toBe("updated");
    expect(state.versions).toHaveLength(1);
    expect(state.agents[0]?.model).toBe("gpt-4o");
  });

  it("updateAgentMaSettings pins an existing version", async () => {
    useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    const updated = await updateAgentMaSettings(TENANT, AGENT, { versionRouting: "pinned", pinnedVersion: 1 });
    expect(updated.versionRouting).toBe("pinned");
    expect(updated.pinnedVersion).toBe(1);
    expect(updated.effectiveVersion).toBe(1);
  });

  it("rejects pinning a missing version", async () => {
    useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    await expect(
      updateAgentMaSettings(TENANT, AGENT, { versionRouting: "pinned", pinnedVersion: 9 }),
    ).rejects.toThrow("固定版本不存在");
  });

  it("follow_latest clears pinned_version", async () => {
    const state = useState();
    await ensureAgentVersionOne(TENANT, AGENT);
    await updateAgentMaSettings(TENANT, AGENT, { versionRouting: "pinned", pinnedVersion: 1 });
    const updated = await updateAgentMaSettings(TENANT, AGENT, { versionRouting: "follow_latest" });
    expect(updated.versionRouting).toBe("follow_latest");
    expect(updated.pinnedVersion).toBeNull();
    expect(state.agents[0]?.pinnedVersion).toBeNull();
  });

  it("rejects environment type mismatch", async () => {
    const state = useState();
    state.environments.push({ tenantId: TENANT, id: "env-desk", type: "desktop_worker", status: "active" });
    await expect(
      updateAgentMaSettings(TENANT, AGENT, { defaultEnvironmentId: "env-desk" }),
    ).rejects.toThrow("默认环境类型与运行方式不一致");
  });

  it("rejects disabled environment", async () => {
    const state = useState();
    state.environments.push({ tenantId: TENANT, id: "env-off", type: "cloud", status: "disabled" });
    await expect(
      updateAgentMaSettings(TENANT, AGENT, { defaultEnvironmentId: "env-off" }),
    ).rejects.toThrow("默认环境不存在或已停用");
  });

  it("resolveEffectiveVersion covers follow_latest, pinned, and pinned without a version", () => {
    expect(resolveEffectiveVersion({ latestVersion: 3, versionRouting: "follow_latest", pinnedVersion: 1 })).toBe(3);
    expect(resolveEffectiveVersion({ latestVersion: 3, versionRouting: "pinned", pinnedVersion: 1 })).toBe(1);
    expect(resolveEffectiveVersion({ latestVersion: 3, versionRouting: "pinned", pinnedVersion: null })).toBe(3);
  });

  it("isForeignKeyViolation detects PG 23503 and MySQL 1451 through cause chain", () => {
    const pg = new Error("wrap");
    (pg as { cause?: unknown }).cause = { code: "23503" };
    const mysql = new Error("wrap");
    (mysql as { cause?: unknown }).cause = { errno: 1451, code: "ER_ROW_IS_REFERENCED_2" };
    expect(isForeignKeyViolation(pg)).toBe(true);
    expect(isForeignKeyViolation(mysql)).toBe(true);
    expect(isForeignKeyViolation(new Error("nope"))).toBe(false);
  });
});

const MEMBER = "B";

function versionRow(agentId: string, version: number, manifest: Record<string, unknown>): AgentVersionRowLike {
  return {
    id: `${agentId}-v${version}`,
    tenantId: TENANT,
    agentId,
    version,
    manifest,
    manifestHash: "sha256:test",
    note: null,
    source: "admin",
    createdBy: null,
    createdAt: "2026-10-25T00:00:00.000Z",
  };
}

describe("multiagent member pinning", () => {
  function withMember(manifest: Record<string, unknown>, latestVersion = 3) {
    const state = useState();
    state.agents.push(agent({ id: MEMBER, latestVersion }));
    state.versions.push(versionRow(MEMBER, latestVersion, manifest));
    return state;
  }

  it("pins member version to latest", async () => {
    withMember({ schema: "agx.agent/v1", model: "openai/gpt-4o", multiagent: null });
    const result = await createAgentVersion(TENANT, AGENT, {
      expectedLatestVersion: 1,
      source: "admin",
      manifest: {
        schema: "agx.agent/v1",
        model: "openai/gpt-4o",
        multiagent: { type: "coordinator", agents: [{ type: "agent", id: MEMBER }] },
      },
    });
    const multiagent = result.version.manifest.multiagent as { agents: Array<{ version: number }> };
    expect(multiagent.agents[0]?.version).toBe(3);
  });

  it("rejects unknown member", async () => {
    useState();
    await expect(
      createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: {
          schema: "agx.agent/v1",
          model: "openai/gpt-4o",
          multiagent: { type: "coordinator", agents: [{ type: "agent", id: "missing" }] },
        },
      }),
    ).rejects.toMatchObject({
      errors: ['manifest.multiagent.agents[0].id: unknown agent "missing"'],
    });
  });

  it("rejects coordinator member", async () => {
    withMember({
      schema: "agx.agent/v1",
      model: "openai/gpt-4o",
      multiagent: { type: "coordinator", agents: [{ type: "self" }] },
    });
    await expect(
      createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: {
          schema: "agx.agent/v1",
          model: "openai/gpt-4o",
          multiagent: { type: "coordinator", agents: [{ type: "agent", id: MEMBER, version: 3 }] },
        },
      }),
    ).rejects.toMatchObject({
      errors: [
        'manifest.multiagent.agents[0].id: agent "B" is a coordinator; only one level of delegation is allowed',
      ],
    });
  });

  it("rejects missing member version", async () => {
    withMember({ schema: "agx.agent/v1", model: "openai/gpt-4o", multiagent: null });
    await expect(
      createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: {
          schema: "agx.agent/v1",
          model: "openai/gpt-4o",
          multiagent: { type: "coordinator", agents: [{ type: "agent", id: MEMBER, version: 9 }] },
        },
      }),
    ).rejects.toMatchObject({
      errors: ['manifest.multiagent.agents[0].version: agent "B" has no version 9'],
    });
  });

  it("rejects self reference on createAgentVersion", async () => {
    useState();
    await expect(
      createAgentVersion(TENANT, AGENT, {
        expectedLatestVersion: 1,
        source: "admin",
        manifest: {
          schema: "agx.agent/v1",
          model: "openai/gpt-4o",
          multiagent: { type: "coordinator", agents: [{ type: "agent", id: AGENT }] },
        },
      }),
    ).rejects.toMatchObject({
      errors: ['manifest.multiagent.agents[0].id: use {"type":"self"} to reference this agent'],
    });
  });

  it("previewAgentManifest without selfAgentId does not report self reference", async () => {
    const state = useState();
    state.versions.push(
      versionRow(AGENT, 1, { schema: "agx.agent/v1", model: "openai/gpt-4o", multiagent: null }),
    );
    const preview = await previewAgentManifest(TENANT, {
      schema: "agx.agent/v1",
      model: "openai/gpt-4o",
      multiagent: { type: "coordinator", agents: [{ type: "agent", id: AGENT }] },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const multiagent = preview.normalized.multiagent as { agents: Array<{ type: string; version: number }> };
    expect(multiagent.agents[0]?.type).toBe("agent");
    expect(multiagent.agents[0]?.version).toBe(1);
  });
});
