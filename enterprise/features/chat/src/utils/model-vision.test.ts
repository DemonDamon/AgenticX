import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isKnownNonVisionChatModel } from "./model-vision";

type VisionCase = { provider: string; model: string; vision: boolean };

describe("portal chat vision catalog", () => {
  it("matches the shared vision catalog", () => {
    const raw = readFileSync(
      new URL("../../../../../agenticx/llms/vision_cases.json", import.meta.url),
      "utf8",
    );
    const cases = JSON.parse(raw) as VisionCase[];
    for (const item of cases) {
      expect(isKnownNonVisionChatModel(item.provider, item.model)).toBe(!item.vision);
    }
  });
});
