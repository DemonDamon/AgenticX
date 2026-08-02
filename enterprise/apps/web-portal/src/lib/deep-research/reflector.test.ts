import { describe, expect, it } from "vitest";
import { MAX_GAPS, parseGapsJson } from "./reflector";

describe("parseGapsJson", () => {
  it("parses fenced gaps", () => {
    const raw = `\`\`\`json
{"gaps":[{"id":"g1","description":"缺官方论文","queries":["deepseek paper"]}]}
\`\`\``;
    const gaps = parseGapsJson(raw);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.description).toContain("官方");
  });

  it("returns empty on empty gaps or invalid json", () => {
    expect(parseGapsJson('{"gaps":[]}')).toEqual([]);
    expect(parseGapsJson("nope")).toEqual([]);
  });

  it("drops gaps without queries and truncates to MAX_GAPS", () => {
    const gaps = Array.from({ length: MAX_GAPS + 2 }, (_, i) => ({
      id: `g${i}`,
      description: `缺口${i}`,
      queries: i === 1 ? [] : [`q${i}`],
    }));
    const parsed = parseGapsJson(JSON.stringify({ gaps }));
    expect(parsed.length).toBeLessThanOrEqual(MAX_GAPS);
    expect(parsed.every((g) => g.queries.length > 0)).toBe(true);
  });
});
