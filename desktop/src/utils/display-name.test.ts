import { describe, expect, it } from "vitest";
import {
  isMetaLeaderAgentId,
  isMetaLeaderIdentity,
  resolveMetaDisplayName,
} from "./display-name";

describe("resolveMetaDisplayName", () => {
  it("maps legacy Machi variants to Near", () => {
    expect(resolveMetaDisplayName("Machi")).toBe("Near");
    expect(resolveMetaDisplayName("machi")).toBe("Near");
    expect(resolveMetaDisplayName("meta")).toBe("Near");
  });

  it("maps empty and avatar placeholder to Near", () => {
    expect(resolveMetaDisplayName("")).toBe("Near");
    expect(resolveMetaDisplayName(null)).toBe("Near");
    expect(resolveMetaDisplayName(undefined)).toBe("Near");
    expect(resolveMetaDisplayName("分身")).toBe("Near");
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
