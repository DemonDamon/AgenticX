import { afterEach, describe, expect, it, vi } from "vitest";

import { scanSkillViaRegistry } from "../skill-registry-scan";

describe("scanSkillViaRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs the skill slug to the existing registry scan endpoint", async () => {
    vi.stubEnv("SKILL_REGISTRY_INTERNAL_TOKEN", "t0ken");
    vi.stubEnv("SKILL_REGISTRY_URL", "http://registry.test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, verdict: "caution", findings: [{ rule: "x" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanSkillViaRegistry("research")).resolves.toEqual({
      verdict: "caution",
      findings: [{ rule: "x" }],
      source: "community",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://registry.test/registry/scan",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-agx-internal-token": "t0ken" }),
      }),
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      name: string;
      source: string;
    };
    expect(body).toEqual({ name: "research", source: "community" });
  });

  it("refuses to call the registry without an internal token", async () => {
    vi.stubEnv("SKILL_REGISTRY_INTERNAL_TOKEN", "");
    await expect(scanSkillViaRegistry("research")).rejects.toThrow(/SKILL_REGISTRY_INTERNAL_TOKEN/);
  });
});
