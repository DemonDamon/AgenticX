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

export type AutomaticDeepResearchSelection = {
  readonly researchQuery: string;
  readonly intentConfidence: DeepResearchIntentConfidence;
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
  | { readonly mode: "web"; readonly source: "requested" }
  | { readonly mode: "plain"; readonly source: "default" };

export function selectTurnPlan(
  requests: TurnRequests,
  automaticSelection?: AutomaticDeepResearchSelection,
): TurnPlan {
  if (requests.manualDeepResearchRequested) {
    return { mode: "deep", source: "manual" };
  }
  if (requests.automaticDeepResearchRequested && automaticSelection) {
    return {
      mode: "deep",
      source: "auto-route",
      researchQuery: automaticSelection.researchQuery,
      intentConfidence: automaticSelection.intentConfidence,
    };
  }
  if (requests.webSearchRequested) {
    return { mode: "web", source: "requested" };
  }
  return { mode: "plain", source: "default" };
}
