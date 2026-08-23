import { describe, expect, it } from "vitest";

import { DEFAULT_PACK_INPUT, DEFAULT_PACK_SLUG, packGrantsEveryone } from "../default-capability-pack";

describe("default capability pack", () => {
  it("seeds web search and deep research for everyone, and nothing else", () => {
    expect(DEFAULT_PACK_INPUT.slug).toBe(DEFAULT_PACK_SLUG);
    expect(DEFAULT_PACK_INPUT.capabilityIds).toEqual(["feature:web_search", "feature:deep_research"]);
    expect(DEFAULT_PACK_INPUT.assignmentKeys).toEqual(["all"]);
    expect(DEFAULT_PACK_INPUT.capabilityIds).not.toContain("feature:attachment_routing");
  });

  it("treats only the all-members key as a grant to everyone", () => {
    expect(packGrantsEveryone(["all"])).toBe(true);
    expect(packGrantsEveryone(["dept:d1", "all"])).toBe(true);
    expect(packGrantsEveryone(["dept:d1"])).toBe(false);
  });
});
