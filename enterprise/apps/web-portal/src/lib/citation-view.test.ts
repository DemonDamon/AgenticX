import { describe, expect, it } from "vitest";
import {
  CITATION_ITEM_KEYS,
  CITATION_VIEW_KEYS,
  assertCitationViewShape,
  buildBrandACitationFixture,
  formatConfidence,
} from "../../../../packages/ui/src/components/data/citation-view";

describe("citation view Brand-A fixture (K1 UI)", () => {
  it("matches citation-ui-contract top-level keys", () => {
    const view = buildBrandACitationFixture();
    for (const key of CITATION_VIEW_KEYS) {
      if (key === "summary") {
        expect(view.summary).toBeTruthy();
        continue;
      }
      expect(view).toHaveProperty(key);
    }
    expect(view.entity_id).toBe("brand-a-pump-01");
    expect(view.entity_id.toLowerCase()).toContain("brand-a");
    expect(assertCitationViewShape(view)).toEqual([]);
  });

  it("citations expose contract item keys and Brand-A provenance", () => {
    const view = buildBrandACitationFixture();
    expect(view.citations.length).toBeGreaterThanOrEqual(2);
    for (const c of view.citations) {
      for (const key of CITATION_ITEM_KEYS) {
        expect(c).toHaveProperty(key);
      }
    }
    expect(view.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(view.conflicts[0]?.identity).toBe("attr:status");
    expect(view.missing).toEqual(expect.arrayContaining(["graph_edge", "attr:owner"]));
    const blob = JSON.stringify(view).toLowerCase();
    expect(blob).not.toMatch(/南网|state.?grid|customer-x/);
  });

  it("formatConfidence", () => {
    expect(formatConfidence(0.95)).toBe("95%");
    expect(formatConfidence(null)).toBe("—");
  });
});
