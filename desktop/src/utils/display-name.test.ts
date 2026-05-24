import { describe, expect, it } from "vitest";
import { resolveMetaDisplayName } from "./display-name";

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
