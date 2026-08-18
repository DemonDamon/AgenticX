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
          icon_url: "https://example.test/icon.png",
          detail_url: "https://skillhub.cn/skills/alphapai-research",
          requires_api_key: true,
          origin_source: "skillhub_api",
          origin_hint: "原生市场结果",
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
        icon_url: "https://example.test/icon.png",
        detail_url: "https://skillhub.cn/skills/alphapai-research",
        requires_api_key: true,
        source: "company-clawhub",
        source_type: "clawhub",
        namespace: "clawhub_boteeenchan-ship-it",
        canonical_name: "@clawhub_boteeenchan-ship-it/alphapai-research",
        origin_source: "skillhub_api",
        origin_hint: "原生市场结果",
        provenance_source: "skillhub",
      },
    ]);
  });

  it("recognizes only the explicit API key requirement metadata", () => {
    const rows = normalizeSkillHubMarketItems([
      {
        slug: "explicit-key",
        labels: { requires_api_key: "true" },
        detailUrl: "https://skillhub.cn/skills/explicit-key",
      },
      {
        slug: "no-key",
        labels: { requires_api_key: "false" },
      },
      {
        slug: "description-only",
        description: "请填写 API Key",
      },
    ]);

    expect(rows[0]).toMatchObject({
      requires_api_key: true,
      detail_url: "https://skillhub.cn/skills/explicit-key",
    });
    expect(rows[1].requires_api_key).toBe(false);
    expect(rows[2].requires_api_key).toBeUndefined();
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
