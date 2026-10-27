import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateRubric } from "../managed-evals";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(testDir, "../../../../../tests/fixtures/managed_agents/rubric_cases.json");

const EXPECTED_RUBRIC_HASHES: Record<string, string> = {
  minimal_rules_ok: "sha256:02816488ee02a090d8c4c341394d8ef89f5e3415cf97b6a54c3c4c50bca40365",
  full_ok: "sha256:def2796d42a73a51016b8dc9ed6e7f972505e19632ec89269dfbfcaee78ebb97",
};

interface RubricCase {
  name: string;
  input: unknown;
  ok: boolean;
  errors: string[];
  normalized: Record<string, unknown> | null;
}

describe("managed eval rubrics", () => {
  const cases = (JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: RubricCase[] }).cases;

  it("rubric cases", () => {
    for (const fixture of cases) {
      const result = validateRubric(fixture.input);
      expect(result.ok, fixture.name).toBe(fixture.ok);
      expect(result.errors, fixture.name).toEqual(fixture.errors);
      expect(result.normalized, fixture.name).toEqual(fixture.normalized);
      if (fixture.ok) {
        expect(result.contentHash, fixture.name).toBe(EXPECTED_RUBRIC_HASHES[fixture.name]);
      }
    }
  });
});
