/** Confidence carried from the existing deep-research route/query resolution step. */
export type DeepResearchIntentConfidence = {
  routeConfidence: number;
  queryConfidence: number;
};

/** Higher than the 0.8 expensive-lane entry threshold: skipping user input is stricter. */
export const MIN_TRUSTED_CLARIFICATION_CONFIDENCE = 0.9;

function isNativeConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * This only permits trusting an explicit `needed=false` from the clarifier.
 * It never bypasses the clarifier and never suppresses a requested question.
 */
export function canTrustNoClarification(
  confidence: DeepResearchIntentConfidence | undefined,
): boolean {
  return Boolean(
    confidence &&
      isNativeConfidence(confidence.routeConfidence) &&
      isNativeConfidence(confidence.queryConfidence) &&
      confidence.routeConfidence >= MIN_TRUSTED_CLARIFICATION_CONFIDENCE &&
      confidence.queryConfidence >= MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
  );
}
