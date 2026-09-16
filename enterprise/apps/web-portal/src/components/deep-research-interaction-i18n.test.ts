import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

const CJK = /[\u4e00-\u9fff]/;

const KEYS = [
  "deepResearchInteractionTitle",
  "deepResearchInteractionAria",
  "deepResearchInteractionHint",
  "deepResearchPlanGateHint",
  "deepResearchInteractionAuto",
  "deepResearchInteractionAutoHint",
  "deepResearchInteractionDirect",
  "deepResearchInteractionDirectHint",
  "deepResearchInteractionCard",
  "deepResearchInteractionCardHint",
  "deepResearchInteractionPlan",
  "deepResearchInteractionPlanHint",
  "copySessionId",
] as const;

describe("deep research interaction i18n", () => {
  it("has paired zh/en workspace keys without CJK in English", () => {
    for (const key of KEYS) {
      expect(zh.workspace[key], `zh missing ${key}`).toEqual(expect.any(String));
      expect(en.workspace[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(en.workspace[key]).not.toMatch(CJK);
      expect(zh.workspace[key]).toMatch(CJK);
    }
  });

  it("locks English chip labels", () => {
    expect(en.workspace.deepResearchInteractionAuto).toBe("Auto");
    expect(en.workspace.deepResearchInteractionTitle).toBe(
      "Clarification and plan confirmation",
    );
  });
});
