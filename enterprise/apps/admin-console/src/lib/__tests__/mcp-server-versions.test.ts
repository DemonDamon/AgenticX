import { describe, expect, it } from "vitest";

import {
  applyPublishCurrent,
  applyPublishDraft,
  applyRollback,
  applySurfaceWrite,
  gatewayVisibleTools,
  surfaceContentHash,
  type SurfaceState,
  type VersionTool,
} from "../mcp-server-versions";

function tool(name: string, enabled = true): VersionTool {
  return {
    toolName: name,
    description: name,
    inputSchema: { type: "object" },
    outputSchema: null,
    enabled,
    sourceOperationId: name,
    metadata: {},
  };
}

function names(state: SurfaceState): string[] {
  return gatewayVisibleTools(state).map((item) => item.toolName);
}

const empty = (): SurfaceState => ({
  publishedVersionId: null,
  liveTools: [tool("legacy")],
  liveBackendConfig: { base_url: "https://live.example", b: 1, a: 2 },
  versions: [],
});

describe("mcp server version surface", () => {
  it("keeps the first edit of an unmanaged server live", () => {
    const next = applySurfaceWrite(empty(), {
      id: "draft-1",
      tools: [tool("imported")],
      backendConfig: { base_url: "https://new.example" },
    });
    expect(next.versions).toEqual([]);
    expect(next.publishedVersionId).toBeNull();
    expect(next.liveTools.map((item) => item.toolName)).toEqual(["imported"]);
    expect(names(next)).toEqual(["imported"]);
  });

  it("publishes the current surface without changing gateway-visible tools", () => {
    const before = empty();
    const published = applyPublishCurrent(before, "ver-1");
    expect(published.publishedVersionId).toBe("ver-1");
    expect(published.versions).toHaveLength(1);
    expect(published.versions[0]).toMatchObject({ version: 1, shelfStatus: "published" });
    expect(names(published)).toEqual(names(before));
    expect(published.liveTools.map((item) => item.toolName)).toEqual(["legacy"]);
  });

  it("stores a later import as a draft until publish, then rolls back", () => {
    const published = applyPublishCurrent(empty(), "ver-1");
    const drafted = applySurfaceWrite(published, {
      id: "ver-2",
      tools: [tool("draftOnly"), tool("hidden", false)],
      backendConfig: { base_url: "https://draft.example" },
    });
    expect(drafted.publishedVersionId).toBe("ver-1");
    expect(drafted.liveTools.map((item) => item.toolName)).toEqual(["legacy"]);
    expect(names(drafted)).toEqual(["legacy"]);
    expect(drafted.versions.map((version) => version.shelfStatus)).toEqual(["published", "draft"]);
    expect(drafted.versions[1]?.version).toBe(2);

    const released = applyPublishDraft(drafted, "ver-2");
    expect(released.publishedVersionId).toBe("ver-2");
    expect(names(released)).toEqual(["draftOnly"]);
    expect(released.liveBackendConfig).toEqual({ base_url: "https://draft.example" });

    const rolled = applyRollback(released, "ver-1");
    expect(rolled.publishedVersionId).toBe("ver-1");
    expect(names(rolled)).toEqual(["legacy"]);
    expect(rolled.liveBackendConfig).toEqual({ base_url: "https://live.example", b: 1, a: 2 });
  });

  it("rejects invalid publish and rollback transitions", () => {
    const published = applyPublishCurrent(empty(), "ver-1");
    const drafted = applySurfaceWrite(published, {
      id: "ver-2",
      tools: [tool("next")],
      backendConfig: {},
    });
    expect(() => applyPublishCurrent(drafted, "ver-3")).toThrow(/already enabled/);
    expect(() => applyPublishDraft(drafted, "ver-1")).toThrow(/not a draft/);
    expect(() => applyRollback(drafted, "ver-2")).toThrow(/not published/);
    expect(() => applyRollback(drafted, "ver-1")).toThrow(/already current/);
    expect(() => applyPublishDraft(drafted, "missing")).toThrow(/not found/);
  });

  it("hashes the stored surface independent of key and tool order", () => {
    const left = surfaceContentHash(
      [tool("b"), tool("a")],
      { z: 1, a: { d: 1, c: 2 } },
    );
    const right = surfaceContentHash(
      [tool("a"), tool("b")],
      { a: { c: 2, d: 1 }, z: 1 },
    );
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });
});
