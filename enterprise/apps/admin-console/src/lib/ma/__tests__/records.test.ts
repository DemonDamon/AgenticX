import { describe, expect, it } from "vitest";

import { toMaAgentRecord, toMaAgentRouting, toMaAgentVersionRecord, toMaEnvironmentRecord } from "../records";
import type { AgentVersion, EnterpriseAgentWithMa, MaEnvironment } from "@agenticx/iam-core";

const agent = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "tenant_1",
  slug: "report-bot",
  displayName: "报告助手",
  description: null,
  systemPrompt: "prompt",
  model: "openai/gpt-4o",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  workerKeys: [],
  status: "active",
  lifecycle: "published",
  origin: "enterprise",
  ownerUserId: null,
  localAvatarId: null,
  metadata: {},
  createdAt: "2026-10-26T08:00:00.000Z",
  updatedAt: "2026-10-26T08:00:00.000Z",
  latestVersion: 2,
  defaultEnvironmentId: null,
  versionRouting: "pinned",
  pinnedVersion: 1,
  effectiveVersion: 1,
} as EnterpriseAgentWithMa;

describe("ma records", () => {
  it("toMaAgentRecord emits exactly the frozen keys", () => {
    expect(Object.keys(toMaAgentRecord(agent)).sort()).toEqual(
      [
        "assignment_keys",
        "default_environment_id",
        "description",
        "display_name",
        "id",
        "latest_version",
        "lifecycle",
        "origin",
        "slug",
        "status",
        "tenant_id",
        "worker_keys",
      ].sort(),
    );
  });

  it("toMaAgentVersionRecord emits exactly 7 keys", () => {
    const version = {
      id: "row",
      tenantId: "tenant_1",
      agentId: agent.id,
      version: 2,
      manifest: { schema: "agx.agent/v1" },
      manifestHash: "sha256:abc",
      note: null,
      source: "admin",
      createdBy: null,
      createdAt: "2026-10-26T08:00:00.000Z",
    } as AgentVersion;
    expect(Object.keys(toMaAgentVersionRecord(version)).sort()).toEqual(
      ["agent_id", "created_at", "created_by", "manifest", "manifest_hash", "note", "version"].sort(),
    );
  });

  it("toMaEnvironmentRecord omits description", () => {
    const env = {
      id: "01BX5ZZKBKACTAV9WEVGEMMVSX",
      tenantId: "tenant_1",
      name: "cloud",
      description: "should not leak",
      type: "cloud",
      config: { type: "cloud", sandbox_backend: "docker", image: null, egress_allow_domains: [], idle_ttl_seconds: 3600 },
      status: "active",
      createdBy: null,
      createdAt: "2026-10-26T08:00:00.000Z",
      updatedAt: "2026-10-26T08:00:00.000Z",
    } as MaEnvironment;
    const record = toMaEnvironmentRecord(env);
    expect(Object.keys(record).sort()).toEqual(["config", "id", "name", "status", "tenant_id", "type"].sort());
    expect(record).not.toHaveProperty("description");
  });

  it("toMaAgentRouting uses effectiveVersion", () => {
    expect(toMaAgentRouting(agent)).toEqual({
      mode: "pinned",
      pinned_version: 1,
      effective_version: 1,
    });
  });
});
