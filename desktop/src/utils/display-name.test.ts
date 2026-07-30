import { describe, expect, it } from "vitest";
import {
  isMetaLeaderAgentId,
  isMetaLeaderIdentity,
  resolveMetaDisplayName,
} from "./display-name";

describe("resolveMetaDisplayName", () => {
  it("maps legacy product variants to the current brand", () => {
    expect(resolveMetaDisplayName("Near")).toBe("和创智派");
    expect(resolveMetaDisplayName("Machi")).toBe("和创智派");
    expect(resolveMetaDisplayName("machi")).toBe("和创智派");
    expect(resolveMetaDisplayName("meta")).toBe("和创智派");
  });

  it("maps empty and avatar placeholder to the current brand", () => {
    expect(resolveMetaDisplayName("")).toBe("和创智派");
    expect(resolveMetaDisplayName(null)).toBe("和创智派");
    expect(resolveMetaDisplayName(undefined)).toBe("和创智派");
    expect(resolveMetaDisplayName("分身")).toBe("和创智派");
  });

  it("preserves custom display names", () => {
    expect(resolveMetaDisplayName("自定义名")).toBe("自定义名");
    expect(resolveMetaDisplayName("  Research Bot  ")).toBe("Research Bot");
  });
});

describe("isMetaLeaderIdentity", () => {
  it("recognizes meta agent ids and legacy Machi labels", () => {
    expect(isMetaLeaderAgentId("meta")).toBe(true);
    expect(isMetaLeaderAgentId("__meta__")).toBe(true);
    expect(isMetaLeaderAgentId("avatar-1")).toBe(false);
    expect(isMetaLeaderIdentity("__meta__", "Machi")).toBe(true);
    expect(isMetaLeaderIdentity("", "Machi")).toBe(true);
    expect(isMetaLeaderIdentity("avatar-1", "飞坦")).toBe(false);
  });
});
