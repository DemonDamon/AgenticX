/**
 * Classify OpenAI-compatible model health-check failures.
 *
 * Gateways such as China Mobile MOMA list models via GET /models, but reject
 * unauthorized model ids on chat/embeddings with Model Auth errors.
 *
 * Author: Damon Li
 */

export type ModelHealthFailureReason = "unauthorized" | "error";

/**
 * Map HTTP status + response body from a probe request to a UI failure reason.
 */
export function classifyModelHealthFailure(
  status: number,
  body: string,
): ModelHealthFailureReason {
  const text = String(body || "");
  const lower = text.toLowerCase();

  if (lower.includes("model auth check") || lower.includes("request denied by model auth")) {
    return "unauthorized";
  }
  if (status === 401 && lower.includes("invalid model")) {
    return "unauthorized";
  }
  if (text.includes("未授权") && text.includes("模型")) {
    return "unauthorized";
  }
  return "error";
}
