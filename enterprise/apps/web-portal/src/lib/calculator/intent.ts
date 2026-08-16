/**
 * Whether a turn is going to need arithmetic, as judged by a model that is
 * already being asked something else.
 *
 * Two routing agents run before retrieval on some turns — the automatic lane
 * router and the contextual query rewriter. Both read the conversation and
 * return JSON. Asking each of them for one extra field costs no additional
 * call, and is the only place in this pipeline where "does this need a
 * calculation" can be decided by something that reads language.
 *
 * Three states, not a boolean, and the reason is structural: these agents run
 * BEFORE the search, so they cannot see the figures. "这家公司上半年表现如何"
 * is genuinely undecidable at that point — whether the answer needs a margin
 * depends on what the pages turn out to say. A boolean forces that turn into a
 * wrong answer either way.
 *
 * The field is advisory and fails open. Absent, malformed, or from an older
 * gateway that never heard of it — all `uncertain`, which plans anyway. Only an
 * explicit `not_needed` skips work, so a model that forgets the field costs a
 * wasted planning call, never a silently ungrounded number.
 */
export type CalculationIntent = "needed" | "not_needed" | "uncertain";

export const DEFAULT_CALCULATION_INTENT: CalculationIntent = "uncertain";

/**
 * Prompt text for the field, shared so two agents cannot describe it
 * differently. Written to be appended to an existing routing prompt: it adds
 * one independent field and says nothing about how the lane is chosen.
 */
export const CALCULATION_INTENT_INSTRUCTION =
  "另外附带独立字段 calculation_intent，取值只能是 needed、not_needed 或 uncertain：" +
  "用户明确要求比例、占比、增长率、变化率、平均、合计、差额等派生数值时为 needed；" +
  "本轮只是查找、叙述或解释事实，答案里不会出现需要现算的数字时为 not_needed；" +
  "是否需要计算取决于检索到的内容时为 uncertain，例如问一家公司“上半年表现如何”。" +
  "拿不准就填 uncertain，不要为了简洁填 not_needed。" +
  "该字段与车道选择无关，不影响其他字段；无法判断时可以省略。";

/**
 * Read the field off a parsed agent reply.
 *
 * Deliberately standalone rather than folded into the callers' schema parsing:
 * a bad value here must never invalidate a routing decision. Everything that is
 * not one of the three literals is `uncertain`.
 */
export function parseCalculationIntent(parsed: unknown): CalculationIntent {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_CALCULATION_INTENT;
  }
  const value = (parsed as Record<string, unknown>).calculation_intent;
  return value === "needed" || value === "not_needed" || value === "uncertain"
    ? value
    : DEFAULT_CALCULATION_INTENT;
}

/**
 * Should the evidence calculation pass run?
 *
 * Only an explicit `not_needed` stops it. `uncertain` plans, because the agent
 * said it could not tell from the question alone and the evidence may settle
 * it; a missing field is `uncertain` for the same reason.
 */
export function allowsEvidencePlanning(intent: CalculationIntent): boolean {
  return intent !== "not_needed";
}
