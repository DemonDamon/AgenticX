import { describe, expect, it } from "vitest";

import { normalizeSkillHubMarketItems } from "./skillhub-market";

describe("normalizeSkillHubMarketItems", () => {
  it("keeps backend install source metadata and marks SkillHub provenance", () => {
    expect(
      normalizeSkillHubMarketItems([
        {
          slug: "alphapai-research",
          name: "AlphaPai Research",
          source: "company-clawhub",
          source_type: "clawhub",
          namespace: "clawhub_boteeenchan-ship-it",
          canonical_name: "@clawhub_boteeenchan-ship-it/alphapai-research",
          downloads: 12,
        },
      ]),
    ).toEqual([
      {
        slug: "alphapai-research",
        name: "AlphaPai Research",
        description: "",
        version: "latest",
        author: "unknown",
        downloads: 12,
        source: "company-clawhub",
        source_type: "clawhub",
        namespace: "clawhub_boteeenchan-ship-it",
        canonical_name: "@clawhub_boteeenchan-ship-it/alphapai-research",
        provenance_source: "skillhub",
      },
    ]);
  });

  it("supports older search payloads and ignores invalid rows", () => {
    const rows = normalizeSkillHubMarketItems([
      null,
      {},
      { slug: "legacy-skill", description: "legacy" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "legacy-skill",
      source: "",
      source_type: "skillhub",
      provenance_source: "skillhub",
    });
  });
});
