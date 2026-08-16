import type { CalculationIntent } from "../calculator/intent";
import type { DeepResearchIntentConfidence } from "../deep-research/clarification-policy";

/** Immutable feature requests parsed from the client body. */
export type TurnRequests = {
  readonly webSearchRequested: boolean;
  readonly manualDeepResearchRequested: boolean;
  readonly automaticDeepResearchRequested: boolean;
};

export const NO_TURN_REQUESTS: TurnRequests = Object.freeze({
  webSearchRequested: false,
  manualDeepResearchRequested: false,
  automaticDeepResearchRequested: false,
});

export type PreparedSearchPlan = {
  readonly query: string;
  readonly needSearch: true;
  readonly searchQueries: readonly string[];
  readonly confidence: number;
  readonly source: "auto-route";
  /** Advisory hint for the evidence calculator; `uncertain` when unstated. */
  readonly calculationIntent: CalculationIntent;
};

export type AutomaticTurnPlan =
  | {
      readonly mode: "plain";
      readonly reason: string;
      readonly calculationIntent: CalculationIntent;
    }
  | {
      readonly mode: "web";
      readonly searchPlan: PreparedSearchPlan;
      readonly reason: string;
    }
  | {
      readonly mode: "deep";
      readonly researchQuery: string;
      readonly intentConfidence: DeepResearchIntentConfidence;
      readonly reason: string;
    };

/**
 * The one executable lane selected for a chat turn. Request flags never double
 * as execution state: manual deep research wins, then a validated automatic
 * selection, then ordinary web search, then plain chat.
 */
export type TurnPlan =
  | {
      readonly mode: "deep";
      readonly source: "manual";
      readonly researchQuery?: string;
      readonly intentConfidence?: DeepResearchIntentConfidence;
    }
  | {
      readonly mode: "deep";
      readonly source: "auto-route";
      readonly researchQuery: string;
      readonly intentConfidence: DeepResearchIntentConfidence;
    }
  | {
      readonly mode: "web";
      readonly source: "requested" | "auto-route";
      readonly searchPlan?: PreparedSearchPlan;
    }
  | {
      readonly mode: "plain";
      readonly source: "default" | "auto-route";
      readonly reason?: string;
      readonly calculationIntent?: CalculationIntent;
    };

export function selectTurnPlan(
  requests: TurnRequests,
  automaticPlan?: AutomaticTurnPlan,
): TurnPlan {
  if (requests.manualDeepResearchRequested) {
    return { mode: "deep", source: "manual" };
  }
  if (requests.automaticDeepResearchRequested && automaticPlan) {
    if (automaticPlan.mode === "plain") {
      return {
        mode: "plain",
        source: "auto-route",
        reason: automaticPlan.reason,
        calculationIntent: automaticPlan.calculationIntent,
      };
    }
    if (automaticPlan.mode === "deep") {
      return {
        mode: "deep",
        source: "auto-route",
        researchQuery: automaticPlan.researchQuery,
        intentConfidence: automaticPlan.intentConfidence,
      };
    }
    if (requests.webSearchRequested) {
      return {
        mode: "web",
        source: "auto-route",
        searchPlan: automaticPlan.searchPlan,
      };
    }
  }
  if (requests.webSearchRequested) {
    return { mode: "web", source: "requested" };
  }
  return { mode: "plain", source: "default" };
}
