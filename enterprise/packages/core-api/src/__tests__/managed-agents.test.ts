import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SERVER_EVENT_TYPES, validateClientEventBatch, validateManifest } from "../managed-agents";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(testDir, "../../../../../tests/fixtures/managed_agents");

const EXPECTED_HASHES: Record<string, string> = {
  "minimal_ok": "sha256:c954e3badab0922a9eeaece960c62a731466246568670e09c849e37cbe1a515a",
  "full_ok": "sha256:0dd6d6555588e8e742ea31ca460e1e59715dd027814d812b2c694dec9dbe0e8b",
  "multiagent_ok": "sha256:5f6bd22a8b2abfe89e9e2b118e722a3ea757da0112542fc913deb6055b49bf85",
  "multiagent_agent_version_omitted_ok": "sha256:c0d5ea7b6a510a0cfef8645eecaa9e4fa8ae861725f84a85150ccb45a1fa136e",
};

interface ManifestCase {
  name: string;
  input: unknown;
  ok: boolean;
  errors: string[];
  normalized: Record<string, unknown> | null;
}

interface EventCase {
  name: string;
  input: unknown;
  ok: boolean;
  code: string | null;
  index: number | null;
}

function loadCases<T>(fileName: string): T[] {
  const raw = JSON.parse(readFileSync(path.join(fixtureDir, fileName), "utf8")) as { cases: T[] };
  return raw.cases;
}

describe("managed agents protocol", () => {
  const manifestCases = loadCases<ManifestCase>("manifest_cases.json");
  const eventCases = loadCases<EventCase>("event_cases.json");

  it("manifest cases", () => {
    for (const fixture of manifestCases) {
      const result = validateManifest(fixture.input);
      expect(result.ok, fixture.name).toBe(fixture.ok);
      expect(result.errors, fixture.name).toEqual(fixture.errors);
      expect(result.normalized, fixture.name).toEqual(fixture.normalized);
    }
  });

  it("oversize", () => {
    const raw = {
      schema: "agx.agent/v1",
      model: "openai/gpt-4o",
      system: "a".repeat(300000),
    };
    const result = validateManifest(raw);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["manifest: exceeds 262144 bytes"]);
    expect(result.normalized).toBeNull();
  });

  it("hash matches python", () => {
    for (const fixture of manifestCases) {
      if (!fixture.ok) continue;
      const result = validateManifest(fixture.input);
      expect(result.manifestHash, fixture.name).toBe(EXPECTED_HASHES[fixture.name]);
    }
  });

  it("multiagent instructions oversize", () => {
    const raw = {
      schema: "agx.agent/v1",
      model: "openai/gpt-4o",
      multiagent: {
        type: "coordinator",
        agents: [
          { type: "self" },
          { type: "advisor", model: "a/b", instructions: "a".repeat(8193) },
        ],
      },
    };
    const result = validateManifest(raw);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "manifest.multiagent.agents[1].instructions: exceeds 8192 bytes",
    ]);
  });

  it("server event types include task events", () => {
    expect(SERVER_EVENT_TYPES).toContain("session.task_created");
    expect(SERVER_EVENT_TYPES).toContain("session.task_completed");
    expect(SERVER_EVENT_TYPES.indexOf("session.task_completed")).toBe(
      SERVER_EVENT_TYPES.indexOf("session.task_created") + 1,
    );
  });

  it("event cases", () => {
    for (const fixture of eventCases) {
      const result = validateClientEventBatch(fixture.input);
      expect(result.ok, fixture.name).toBe(fixture.ok);
      if (fixture.ok) {
        expect(result.ok, fixture.name).toBe(true);
        continue;
      }
      if (result.ok) {
        throw new Error(`${fixture.name} unexpectedly accepted`);
      }
      expect(result.code, fixture.name).toBe(fixture.code);
      expect(result.index, fixture.name).toBe(fixture.index);
    }
  });
});
