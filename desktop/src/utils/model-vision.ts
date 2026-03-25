/**
 * Known text-only / non-vision chat models: block image attach + toast (Cherry-style).
 * Other models: permissive (allow attach).
 */

const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

/**
 * MiniMax M2 product line: vendor docs state no image/audio input for these chat models
 * (M2, M2.1, M2.5, M2.7 and *-highspeed; not VL). Slug = model id without provider prefix.
 */
function minimaxM2TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision/.test(s)) return false;
  if (s.startsWith("minimax-m2")) return true;
  if (/^m2[.\-_]?\d/.test(s)) return true;
  return false;
}

/** Zhipu GLM-5 line: text chat only on paas v4; multimodal parts return 400. */
function zhipuGlm5TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision|4v|5v/.test(s)) return false;
  return s === "glm-5" || s.startsWith("glm-5-");
}

/**
 * Returns true if we are confident the current model does not accept image input.
 * Empty model id → false (do not block).
 */
export function isKnownNonVisionChatModel(provider: string, model: string): boolean {
  const m = (model || "").trim();
  if (!m) return false;
  const p = (provider || "").trim().toLowerCase();
  const modelLower = m.toLowerCase();
  const combined = `${p}/${modelLower}`;
  const slug = modelLower.includes("/") ? (modelLower.split("/").pop() ?? modelLower) : modelLower;

  if (KNOWN_TEXT_ONLY_RE.test(combined) || KNOWN_TEXT_ONLY_RE.test(modelLower)) return true;
  if (p === "minimax" && minimaxM2TextOnlySlug(slug)) return true;
  if (p === "zhipu" && zhipuGlm5TextOnlySlug(slug)) return true;
  return false;
}
