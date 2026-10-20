import { describe, expect, it } from "vitest";
import type { FeatureUsageState } from "@agenticx/config";

import { featureUsageRemainingText, isFeatureUsageExhausted } from "./FeatureUsageNotice";

function state(
  partial: Partial<FeatureUsageState> & Pick<FeatureUsageState, "binding">,
): FeatureUsageState {
  return {
    feature: "deep_research_runs",
    source: "default",
    unlimited: false,
    windows: partial.binding ? [partial.binding] : [],
    ...partial,
  };
}

describe("featureUsageRemainingText", () => {
  it("reads as used over limit, for the window that actually binds", () => {
    expect(
      featureUsageRemainingText(
        state({ binding: { window: "day", limit: 3, used: 1, remaining: 2 } }),
      ),
    ).toBe("今日 1/3");
    expect(
      featureUsageRemainingText(
        state({ binding: { window: "month", limit: 40, used: 12, remaining: 28 } }),
      ),
    ).toBe("本月 12/40");
  });

  it("does not show more used than the limit after an allowance is lowered", () => {
    expect(
      featureUsageRemainingText(
        state({ binding: { window: "day", limit: 3, used: 5, remaining: 0 } }),
      ),
    ).toBe("今日 3/3");
  });

  it("shows nothing when there is no ceiling", () => {
    expect(
      featureUsageRemainingText(
        state({ unlimited: true, binding: null, windows: [] }),
      ),
    ).toBeNull();
    expect(featureUsageRemainingText(null)).toBeNull();
  });

  it("says the count is unavailable instead of inventing a remaining number", () => {
    expect(
      featureUsageRemainingText(
        state({ unavailable: true, unlimited: false, binding: null, windows: [] }),
      ),
    ).toBe("额度暂不可用");
  });
});

describe("isFeatureUsageExhausted", () => {
  it("is true only once nothing is left", () => {
    expect(
      isFeatureUsageExhausted(
        state({ binding: { window: "day", limit: 3, used: 2, remaining: 1 } }),
      ),
    ).toBe(false);
    expect(
      isFeatureUsageExhausted(
        state({ binding: { window: "day", limit: 3, used: 3, remaining: 0 } }),
      ),
    ).toBe(true);
  });

  it("is never true for a member with no ceiling", () => {
    expect(
      isFeatureUsageExhausted(state({ unlimited: true, binding: null, windows: [] })),
    ).toBe(false);
    expect(isFeatureUsageExhausted(null)).toBe(false);
  });
});
