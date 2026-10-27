import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MaCronValidationError, parseCron, validateTimezone } from "../ma-cron";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../tests/fixtures/managed_agents/cron_cases.json",
);

type Fixture = {
  valid: string[];
  invalid: Array<{ expr: string; error: string }>;
};

describe("ma cron", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

  it("matches shared cron fixture", () => {
    for (const expr of fixture.valid) {
      expect(() => parseCron(expr), expr).not.toThrow();
    }
    for (const item of fixture.invalid) {
      expect(() => parseCron(item.expr), item.expr).toThrow(MaCronValidationError);
      try {
        parseCron(item.expr);
      } catch (error) {
        expect(error).toBeInstanceOf(MaCronValidationError);
        expect((error as Error).message).toBe(item.error);
      }
    }
  });

  it("folds Sunday 7 to 0 and rejects unknown time zones", () => {
    const parsed = parseCron("0 12 15 * 7");
    expect(parsed.dayOfWeek).toEqual([0]);
    expect(parsed.dowRestricted).toBe(true);
    expect(validateTimezone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(() => validateTimezone("Not/AZone")).toThrow(new MaCronValidationError("timezone: unknown time zone"));
  });
});
