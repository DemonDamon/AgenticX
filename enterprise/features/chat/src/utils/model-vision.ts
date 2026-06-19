const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

function minimaxM2TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision/.test(s)) return false;
  if (s.startsWith("minimax-m2")) return true;
  if (/^m2[.\-_]?\d/.test(s)) return true;
  return false;
}

function zhipuGlm5TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision|4v|5v/.test(s)) return false;
  return s === "glm-5" || /^glm-5([.\-_]|$)/.test(s);
}

function bailianQwenTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision|omni/.test(s)) return false;
  return s.startsWith("qwen");
}

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
  if ((p === "bailian" || p === "dashscope") && bailianQwenTextOnlySlug(slug)) return true;
  return false;
}

export function modelSupportsVision(
  provider: string,
  model: string,
  capabilities?: string[] | null,
): boolean {
  if (capabilities?.includes("vision")) return true;
  return !isKnownNonVisionChatModel(provider, model);
}
