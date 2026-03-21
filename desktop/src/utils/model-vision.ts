/**
 * Heuristic: known text-only / non-vision chat models (attach image should be blocked + toast).
 * Vision-capable models are everything else when a model id is set — permissive default.
 */

const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

/**
 * Returns true if we are confident the current model does not accept image input.
 * Empty model id → false (do not block; user may not have selected yet).
 */
export function isKnownNonVisionChatModel(provider: string, model: string): boolean {
  const m = (model || "").trim();
  if (!m) return false;
  const combined = `${(provider || "").trim().toLowerCase()}/${m.toLowerCase()}`;
  return KNOWN_TEXT_ONLY_RE.test(combined) || KNOWN_TEXT_ONLY_RE.test(m.toLowerCase());
}
