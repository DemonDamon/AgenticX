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

/** Zhipu GLM text SKUs (no digit+"v" vision marker) reject image_url on paas v4. */
function zhipuTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/\dv|vision|vl/.test(s)) return false;
  return /^glm-(5|4\.6|4\.5|4|z1|zero)/.test(s);
}

/** Bailian/DashScope text Qwen SKUs reject OpenAI-style image_url blocks (e.g. qwen3.7-max). */
function bailianQwenTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision|omni/.test(s)) return false;
  return s.startsWith("qwen");
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
  // Known text-only families are matched by model slug regardless of provider,
  // so custom OpenAI-compatible gateways serving these SKUs are also blocked.
  if (minimaxM2TextOnlySlug(slug)) return true;
  if (zhipuTextOnlySlug(slug)) return true;
  if (bailianQwenTextOnlySlug(slug)) return true;
  return false;
}
