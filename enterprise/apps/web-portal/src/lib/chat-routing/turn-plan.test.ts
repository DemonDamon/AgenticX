import { describe, expect, it } from "vitest";
import { selectTurnPlan, type TurnRequests } from "./turn-plan";

const requests = (overrides: Partial<TurnRequests> = {}): TurnRequests => ({
  webSearchRequested: false,
  manualDeepResearchRequested: false,
  automaticDeepResearchRequested: false,
  ...overrides,
});

const automaticSelection = {
  researchQuery: "比较三种方案并给出多来源报告",
  intentConfidence: { routeConfidence: 0.94, queryConfidence: 0.93 },
};

describe("selectTurnPlan", () => {
  it("keeps an explicit manual request above automatic and web lanes", () => {
    expect(
      selectTurnPlan(
        requests({
          webSearchRequested: true,
          manualDeepResearchRequested: true,
          automaticDeepResearchRequested: true,
        }),
        automaticSelection,
      ),
    ).toEqual({ mode: "deep", source: "manual" });
  });

  it("selects a validated automatic deep-research result", () => {
    expect(
      selectTurnPlan(
        requests({
          webSearchRequested: true,
          automaticDeepResearchRequested: true,
        }),
        automaticSelection,
      ),
    ).toEqual({
      mode: "deep",
      source: "auto-route",
      ...automaticSelection,
    });
  });

  it("falls through to requested web search when automatic routing declines", () => {
    expect(
      selectTurnPlan(
        requests({
          webSearchRequested: true,
          automaticDeepResearchRequested: true,
        }),
      ),
    ).toEqual({ mode: "web", source: "requested" });
  });

  it("does not accept an automatic selection when automatic routing was not requested", () => {
    expect(
      selectTurnPlan(requests({ webSearchRequested: true }), automaticSelection),
    ).toEqual({ mode: "web", source: "requested" });
  });

  it("uses plain chat when no executable retrieval lane remains", () => {
    expect(
      selectTurnPlan(requests({ automaticDeepResearchRequested: true })),
    ).toEqual({ mode: "plain", source: "default" });
    expect(selectTurnPlan(requests())).toEqual({ mode: "plain", source: "default" });
  });
});
