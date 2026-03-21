/**
 * Known text-only / non-vision chat models: block image attach + toast (Cherry-style).
 * Other models: permissive (allow attach).
 */

const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

/**
 * MiniMax M2.x chat line (e.g. M2.7): vendor docs state no image/audio input.
 * Slug is model id without provider prefix, lowercased.
 */
function minimaxM2TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision/.test(s)) return false;
  if (s.includes("minimax-m2")) return true;
  if (/^m2[.\-_]?\d/.test(s)) return true;
  return false;
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
  return false;
}
