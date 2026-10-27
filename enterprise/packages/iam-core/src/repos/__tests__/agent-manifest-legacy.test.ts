import { validateManifest } from "@agenticx/core-api";
import { describe, expect, it } from "vitest";

import {
  buildLegacyManifest,
  deriveManifestFromLegacyEdit,
  deriveProjectionCapabilityIds,
  pinTenantSkillVersions,
  type LegacyAgentFields,
} from "../agent-manifest-legacy";

const SKILL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const MCP_ID = "01BX5ZZKBKACTAV9WEVGEMMVRZ";

function agent(patch: Partial<LegacyAgentFields> = {}): LegacyAgentFields {
  return {
    model: "openai/gpt-4o",
    systemPrompt: "hello",
    capabilityIds: [],
    metadata: {},
    ...patch,
  };
}

describe("legacy manifest mapping", () => {
  it("buildLegacyManifest maps found skills into skills[] with pinned version", () => {
    const manifest = buildLegacyManifest(
      agent({ capabilityIds: [`skill:${SKILL_ID}`, `mcp:${MCP_ID}`] }),
      new Map([[SKILL_ID, "1.2.0"]]),
    );
    expect(manifest.skills).toEqual([{ source: "tenant", id: SKILL_ID, version: "1.2.0" }]);
    expect(manifest.metadata).toMatchObject({ legacy_capability_ids: [`mcp:${MCP_ID}`] });
    expect(manifest.tools).toEqual([]);
    expect(manifest.mcp_servers).toEqual([]);
  });

  it("unknown skill falls back to legacy_capability_ids", () => {
    const manifest = buildLegacyManifest(agent({ capabilityIds: [`skill:${SKILL_ID}`] }), new Map());
    expect(manifest.skills).toEqual([]);
    expect((manifest.metadata as { legacy_capability_ids: string[] }).legacy_capability_ids).toEqual([
      `skill:${SKILL_ID}`,
    ]);
  });

  it("strips system-managed metadata keys", () => {
    const manifest = buildLegacyManifest(
      agent({ metadata: { model: "x", agentName: "y", knowledgeSearchUrl: "https://kb" } }),
      new Map(),
    );
    expect(manifest.metadata).toEqual({ knowledgeSearchUrl: "https://kb" });
  });

  it("omits legacy_capability_ids when empty", () => {
    const manifest = buildLegacyManifest(agent(), new Map());
    expect(manifest.metadata).not.toHaveProperty("legacy_capability_ids");
  });

  it("backfilled manifest passes validateManifest and hash is stable", () => {
    const raw = buildLegacyManifest(agent({ capabilityIds: [`skill:${SKILL_ID}`] }), new Map([[SKILL_ID, "1.2.0"]]));
    const first = validateManifest(raw);
    const second = validateManifest(raw);
    expect(first.ok).toBe(true);
    expect(first.manifestHash).toBe(second.manifestHash);
  });

  it("deriveProjectionCapabilityIds orders tenant skills before legacy ids", () => {
    const ids = deriveProjectionCapabilityIds({
      skills: [
        { source: "builtin", id: "web_search", version: null },
        { source: "tenant", id: SKILL_ID, version: "1.2.0" },
      ],
      metadata: { legacy_capability_ids: [`mcp:${MCP_ID}`, `skill:${SKILL_ID}`] },
    });
    expect(ids).toEqual([`skill:${SKILL_ID}`, `mcp:${MCP_ID}`]);
  });

  it("deriveManifestFromLegacyEdit keeps editor-authored tools, mcp_servers and metadata", () => {
    const base = {
      schema: "agx.agent/v1",
      model: "openai/old",
      system: "sys",
      tools: [{ type: "custom", name: "Echo", description: "echo", input_schema: {} }],
      mcp_servers: [{ name: "docs", url: "https://example.com/mcp" }],
      skills: [],
      multiagent: null,
      runtime: { max_tool_rounds: 40, max_session_tokens: null },
      metadata: { welcome_message: "hi" },
    };
    const next = deriveManifestFromLegacyEdit(
      base,
      agent({ model: "openai/new", systemPrompt: "sys" }),
      new Map(),
      false,
    );
    expect(next.model).toBe("openai/new");
    expect(next.tools).toEqual(base.tools);
    expect(next.mcp_servers).toEqual(base.mcp_servers);
    expect(next.metadata).toEqual({ welcome_message: "hi" });
  });

  it("pinTenantSkillVersions reports unknown tenant skills", () => {
    const pinned = pinTenantSkillVersions(
      { skills: [{ source: "tenant", id: SKILL_ID, version: null }] },
      new Map(),
    );
    expect(pinned.errors).toEqual([`manifest.skills[0].id: unknown tenant skill "${SKILL_ID}"`]);
  });
});
