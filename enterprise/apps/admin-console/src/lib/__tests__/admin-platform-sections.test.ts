import { describe, expect, it } from "vitest";
import { isPlatformSection, PLATFORM_SECTION_IDS } from "../admin-platform-sections";

describe("isPlatformSection", () => {
  it("accepts the platform slugs that share /admin/[section]", () => {
    expect(PLATFORM_SECTION_IDS).toEqual([
      "models",
      "channels",
      "cache",
      "api-tokens",
      "mcp-servers",
      "capabilities",
      "plugins",
    ]);
    for (const id of PLATFORM_SECTION_IDS) {
      expect(isPlatformSection(id)).toBe(true);
    }
  });

  it("rejects other /admin pages that keep their own routes", () => {
    expect(isPlatformSection("compliance")).toBe(false);
    expect(isPlatformSection("errors")).toBe(false);
    expect(isPlatformSection("perf")).toBe(false);
    expect(isPlatformSection("session-grants")).toBe(false);
    expect(isPlatformSection("")).toBe(false);
  });
});
