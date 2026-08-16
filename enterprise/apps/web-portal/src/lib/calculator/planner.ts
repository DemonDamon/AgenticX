/**
 * One bounded planning call, executed locally and anchored to source text.
 *
 * The model decides what to compute; it never supplies a value. Every operand
 * it names must already appear in the text it was given, `core.ts` does the
 * arithmetic in decimal, and the results are handed back as context. That
 * division is the whole design, and it is the same for an ordinary chat turn
 * and for a grounded web search answer — only the prompt and the text operands
 * may be drawn from differ, so only those are parameters.
 *
 * The portal sends no `tools` upstream and reads no `tool_calls` back: every
 * path here strips both, because providers in this deployment ignore
 * `tool_choice` or answer with proprietary XML. A planning call is how a model
 * decides something in this codebase.
 */
import { parseLlmJson } from "../deep-research/llm-json";
import { canonicalDecimal, executeCalculatorBatch, type CalculatorResult } from "./core";

/**
 * A planner is deliberately bounded so a stalled provider cannot hold the
 * user's answer open forever. This is a network safety ceiling, not a limit on
 * how long the answering model may reason. Both chat and grounded search use
 * the same value so one path cannot silently become less reliable than the
 * other.
 */
export const CALCULATOR_PLANNER_TIMEOUT_MS = 15_000;

export type CalculatorGatewayDeps = {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * A number as written. The leading sign is only part of the number when nothing
 * numeric precedes it: in "1-2" the `-` is an operator and the operands are 1
 * and 2, so scanning it as `-2` made the planner's honest `difference(1, 2)`
 * look unanchored and dropped the whole calculation.
 */
export const NUMBER_SHAPE_RE =
  /(?<![\d)])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/gu;

/** The operation menu, written once so two prompts cannot describe it differently. */
export const CALCULATOR_OPERATION_SPEC = `operation 只能是：
- sum：求和，至少两个数
- difference：第一个数减第二个数
- product：相乘，至少两个数
- quotient：第一个数除以第二个数
- average：平均值，至少两个数
- percent_of：某百分比对应的数值，operands 固定为 [百分数, 基数]；12.5% 传 "12.5"
- percentage_change：从旧值到新值的百分比变化，operands 固定为 [旧值, 新值]`;

export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const row = part as Record<string, unknown>;
      return row.type === "text" && typeof row.text === "string" ? [row.text] : [];
    })
    .join("\n");
}

/**
 * Every number the given texts actually state, in canonical decimal form.
 *
 * Canonical rather than literal, so "1,234.56" and "1234.56" are the same
 * number while "1234.65" is not.
 */
export function collectAnchors(texts: readonly string[]): Set<string> {
  const anchors = new Set<string>();
  for (const text of texts) {
    for (const token of text.match(NUMBER_SHAPE_RE) ?? []) {
      const literal = canonicalDecimal(token.replace(/%$/u, ""));
      if (literal) anchors.add(literal);
    }
  }
  return anchors;
}

/**
 * Drop any calculation whose operands were not stated in the source text.
 *
 * The planner is told not to invent numbers, and nothing else enforces it. The
 * operands travel to the answering model inside a system message the user never
 * sees, so a figure misread from a search snippet would be computed exactly and
 * reported confidently with nothing to notice it by. Calculations that survive
 * are kept; a batch left with none degrades to the ungrounded path unchanged.
 */
export function anchoredResults(
  results: readonly CalculatorResult[],
  anchors: ReadonlySet<string>,
): CalculatorResult[] {
  return results.filter((result) =>
    result.operands.every((operand) => {
      const literal = canonicalDecimal(operand);
      return literal !== null && anchors.has(literal);
    }),
  );
}

function completionText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return "";
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return "";
  return textContent((message as Record<string, unknown>).content);
}

/** Strip anything that would make the planning call stream, branch or cost more. */
function plannerBody(
  body: Record<string, unknown>,
  system: string,
  user: string,
): Record<string, unknown> {
  const {
    messages: _messages,
    tools: _tools,
    tool_choice: _toolChoice,
    stream: _stream,
    temperature: _temperature,
    max_tokens: _maxTokens,
    max_completion_tokens: _maxCompletionTokens,
    ...rest
  } = body;
  return {
    ...rest,
    stream: false,
    temperature: 0,
    max_tokens: 600,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export type PlanCalculationsInput = {
  deps: CalculatorGatewayDeps;
  /** Upstream request body, reused so the turn's model and routing are kept. */
  body: Record<string, unknown>;
  system: string;
  user: string;
  /**
   * Canonical numbers an operand may be drawn from. The caller builds this,
   * because only the caller knows which of the text it shows the model is
   * source material and which is scaffolding it added itself.
   */
  anchors: ReadonlySet<string>;
  traceStage: string;
};

/**
 * Plan, execute and anchor. Returns an empty array for every failure mode —
 * unreachable gateway, non-JSON reply, rejected arithmetic, unanchored operand
 * — so a caller never has to distinguish "nothing to compute" from "could not
 * compute", and an ordinary answer is produced either way. Infrastructure
 * failures remain invisible to the end user, but are logged with the trace
 * stage so they are no longer indistinguishable from a legitimate empty plan.
 */
export async function planCalculations(
  input: PlanCalculationsInput,
): Promise<CalculatorResult[]> {
  const { deps } = input;
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CALCULATOR_PLANNER_TIMEOUT_MS);
  if (deps.signal?.aborted) controller.abort();
  else deps.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const response = await (deps.fetchImpl ?? fetch)(deps.url, {
      method: "POST",
      headers: { ...deps.headers, "x-agenticx-trace-stage": input.traceStage },
      body: JSON.stringify(plannerBody(input.body, input.system, input.user)),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(
        `[calculator] planner request failed stage=${input.traceStage} status=${response.status}`,
      );
      return [];
    }
    const planned = parseLlmJson<unknown>(completionText(await response.json()));
    const executed = executeCalculatorBatch(planned).filter(
      (result): result is CalculatorResult & { value: string; displayValue: string } =>
        result.status === "ok" &&
        typeof result.value === "string" &&
        typeof result.displayValue === "string",
    );
    return anchoredResults(executed, input.anchors);
  } catch (error) {
    if (timedOut) {
      console.warn(
        `[calculator] planner timed out stage=${input.traceStage} timeout_ms=${CALCULATOR_PLANNER_TIMEOUT_MS}`,
      );
    } else if (!deps.signal?.aborted) {
      console.warn(
        `[calculator] planner failed stage=${input.traceStage} reason=${error instanceof Error ? error.name : "unknown"}`,
      );
    }
    return [];
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * The block handed to the answering model.
 *
 * Two authorities, kept apart on purpose. The arithmetic is settled here and
 * the model must not redo it — a model re-deriving a division it was handed is
 * the failure this feature exists to prevent. Which figures to divide is not
 * settled here, and saying so matters: an earlier wording told the model it
 * "must use the result and may not rewrite the values", and it read that as
 * covering the operands too.
 *
 * In a real turn that cost the answer. The model found three prices newer than
 * the one the planner had chosen, worked out for itself that a third source's
 * per-share figure was quarterly rather than trailing, and then talked itself
 * back into the stale pair because it believed it was not allowed to disagree.
 * It was better placed than the planner to make that call — it reads the prose
 * the figures are embedded in — and had been forbidden from making it.
 *
 * The same wording produced the display noise. Told not to rewrite the value,
 * a ratio was quoted to twelve decimal places.
 */
export function calculationContextBlock(results: readonly CalculatorResult[]): string {
  const payload = results.map((result) => ({
    id: result.id,
    operation: result.operation,
    operands: result.operands,
    value: result.value,
    displayValue: result.displayValue,
    precision: result.precision,
  }));
  return (
    "## 本轮确定性计算结果\n" +
    "以下数值由本地十进制计算器按给定 operands 精确算出。\n" +
    "- 算术以此为准：不要重算，也不要换成别的数字。" +
    "展示时可以按语境四舍五入（例如比率保留两位小数），不必照搬全部位数。\n" +
    "- 操作数选得对不对由你判断：如果材料里有时点更贴近问题、或口径更一致的数，" +
    "直接用材料里的数回答并说明依据，不必迁就下面的结果。\n" +
    "- 只在与用户问题相关时使用，不要向用户描述内部规划器或调用流程。\n" +
    JSON.stringify(payload)
  );
}
