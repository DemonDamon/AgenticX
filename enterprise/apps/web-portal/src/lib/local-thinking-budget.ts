import { modelPrefillsThinkTag } from "@agenticx/config";

/** Keep local reasoning inside the output cap, leaving room for the answer. */
export function withLocalThinkingBudget(
  body: Record<string, unknown>,
  model: { id: string; route: string } | null,
): Record<string, unknown> {
  if (model?.route !== "local" || !modelPrefillsThinkTag(model.id)) return body;
  const template = body.chat_template_kwargs as Record<string, unknown> | undefined;
  if (template?.enable_thinking === false || body.enable_thinking === false) return body;

  const configured = Number(process.env.AGENTICX_LOCAL_THINKING_TOKEN_BUDGET ?? 2048);
  const defaultBudget = Number.isInteger(configured) && configured >= 0 ? configured : 2048;
  const requested = body.thinking_token_budget;
  if (requested !== undefined && (!Number.isInteger(requested) || Number(requested) < 0)) return body;
  let budget = requested === undefined ? defaultBudget : Number(requested);
  const cap = Number(body.max_completion_tokens ?? body.max_tokens);
  if (Number.isInteger(cap) && cap > 0) budget = Math.min(budget, Math.floor(cap / 2));
  return { ...body, thinking_token_budget: budget };
}
