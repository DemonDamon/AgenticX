const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

function minimaxM2TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision/.test(s)) return false;
  if (s.startsWith("minimax-m2")) return true;
  if (/^m2[.\-_]?\d/.test(s)) return true;
  return false;
}

/** Zhipu GLM text SKUs (no digit+"v" / GLM-5.3 multimodal line) reject image input. */
function zhipuTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/\dv|vision|vl/.test(s)) return false;
  if (s.startsWith("glm-5.3")) return false;
  return /^glm-(5|4\.6|4\.5|4|z1|zero)/.test(s);
}

/** MiMo speech SKUs and the text-only v2.5-pro line reject image input. */
function mimoTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (!s.startsWith("mimo-")) return false;
  if (s.includes("-asr") || s.includes("-tts")) return true;
  return s === "mimo-v2.5-pro" || s.startsWith("mimo-v2.5-pro-");
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
  // Same slug rules as agenticx/llms/vision.py. Provider name does not exempt a known text-only SKU.
  if (minimaxM2TextOnlySlug(slug)) return true;
  if (zhipuTextOnlySlug(slug)) return true;
  if (bailianQwenTextOnlySlug(slug)) return true;
  if (mimoTextOnlySlug(slug)) return true;
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
