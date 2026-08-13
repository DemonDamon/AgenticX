import { describe, expect, it } from "vitest";
import {
  selectTurnPlan,
  type AutomaticTurnPlan,
  type TurnRequests,
} from "./turn-plan";

const requests = (overrides: Partial<TurnRequests> = {}): TurnRequests => ({
  webSearchRequested: false,
  manualDeepResearchRequested: false,
  automaticDeepResearchRequested: false,
  ...overrides,
});

const automaticDeepPlan: AutomaticTurnPlan = {
  mode: "deep",
  researchQuery: "比较三种方案并给出多来源报告",
  intentConfidence: { routeConfidence: 0.94, queryConfidence: 0.93 },
  reason: "需要多来源核验",
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
        automaticDeepPlan,
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
        automaticDeepPlan,
      ),
    ).toEqual({
      mode: "deep",
      source: "auto-route",
      researchQuery: automaticDeepPlan.researchQuery,
      intentConfidence: automaticDeepPlan.intentConfidence,
    });
  });

  it("carries a validated automatic web plan into the web lane", () => {
    const automaticWebPlan: AutomaticTurnPlan = {
      mode: "web",
      reason: "单次搜索足够",
      searchPlan: {
        query: "王虹 近期新闻",
        needSearch: true,
        searchQueries: ["数学家 王虹 近期新闻"],
        confidence: 0.96,
        source: "auto-route",
      },
    };
    expect(
      selectTurnPlan(
        requests({
          webSearchRequested: true,
          automaticDeepResearchRequested: true,
        }),
        automaticWebPlan,
      ),
    ).toEqual({
      mode: "web",
      source: "auto-route",
      searchPlan: automaticWebPlan.searchPlan,
    });
  });

  it("cannot enable web search when the client did not request that lane", () => {
    const automaticWebPlan: AutomaticTurnPlan = {
      mode: "web",
      reason: "需要公开信息",
      searchPlan: {
        query: "近期新闻",
        needSearch: true,
        searchQueries: ["近期新闻"],
        confidence: 0.96,
        source: "auto-route",
      },
    };
    expect(
      selectTurnPlan(
        requests({ automaticDeepResearchRequested: true }),
        automaticWebPlan,
      ),
    ).toEqual({ mode: "plain", source: "default" });
  });

  it("honors a confident automatic plain decision", () => {
    expect(
      selectTurnPlan(
        requests({
          webSearchRequested: true,
          automaticDeepResearchRequested: true,
        }),
        { mode: "plain", reason: "基于现有上下文即可回答" },
      ),
    ).toEqual({
      mode: "plain",
      source: "auto-route",
      reason: "基于现有上下文即可回答",
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
      selectTurnPlan(requests({ webSearchRequested: true }), automaticDeepPlan),
    ).toEqual({ mode: "web", source: "requested" });
  });

  it("uses plain chat when no executable retrieval lane remains", () => {
    expect(
      selectTurnPlan(requests({ automaticDeepResearchRequested: true })),
    ).toEqual({ mode: "plain", source: "default" });
    expect(selectTurnPlan(requests())).toEqual({ mode: "plain", source: "default" });
  });
});
