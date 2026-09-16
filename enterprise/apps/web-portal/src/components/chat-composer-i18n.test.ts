import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

const CJK = /[\u4e00-\u9fff]/;
const KEYS = ["composerPlaceholder", "planRevisePlaceholder"] as const;

describe("chat composer i18n", () => {
  it("has paired zh/en placeholders for the input area", () => {
    for (const key of KEYS) {
      expect(zh.chat[key], `zh missing ${key}`).toEqual(expect.any(String));
      expect(en.chat[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(en.chat[key]).not.toMatch(CJK);
      expect(zh.chat[key]).toMatch(CJK);
    }
  });
});
