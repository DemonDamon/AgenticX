/**
 * Infer chat model capabilities for admin provider catalog (text / vision / reasoning).
 * Mirrors enterprise/features/chat model-vision heuristics without pulling feature-chat into admin-console.
 */

const KNOWN_TEXT_ONLY_RE =
  /(gpt-3\.5|gpt-35|text-embedding|embedding-3|whisper|davinci|babbage|deepseek-chat|deepseek-coder|deepseek-reasoner)/i;

function modelSlug(modelId: string): string {
  const lower = (modelId || "").trim().toLowerCase();
  return lower.includes("/") ? (lower.split("/").pop() ?? lower) : lower;
}

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
  if (!m) return true;
  const p = (provider || "").trim().toLowerCase();
  const modelLower = m.toLowerCase();
  const combined = `${p}/${modelLower}`;
  const slug = modelSlug(m);

  if (KNOWN_TEXT_ONLY_RE.test(combined) || KNOWN_TEXT_ONLY_RE.test(modelLower)) return true;
  if (p === "minimax" && minimaxM2TextOnlySlug(slug)) return true;
  if (p === "zhipu" && zhipuGlm5TextOnlySlug(slug)) return true;
  if ((p === "dashscope" || p === "bailian") && bailianQwenTextOnlySlug(slug)) return true;
  return false;
}

const REASONING_RE =
  /(?:^|\/)(?:deepseek-r1|.*-r1(?:-|$)|.*reasoner.*|.*-thinking(?:-|$)|qwq(?:-|$))/i;

const EMBEDDING_RE =
  /(?:^|[-_/])(?:text-embedding|multimodal-embedding|embedding|embed)(?:[-_/]|$)/i;

export function isEmbeddingModelId(modelId: string): boolean {
  const slug = modelSlug(modelId);
  if (!slug) return false;
  if (/^text-embedding(?:-|$)/i.test(slug)) return true;
  if (/^(?:multimodal-embedding|qwen[\d.]*-vl-embedding|tongyi-embedding-vision)/i.test(slug)) return true;
  return EMBEDDING_RE.test(slug) && !/chat|coder|vl-plus(?!-embedding)/i.test(slug);
}

export function inferModelCapabilities(providerId: string, modelName: string): string[] {
  if (isEmbeddingModelId(modelName)) {
    return ["embedding"];
  }
  const caps: string[] = ["text"];
  if (REASONING_RE.test(modelName)) {
    caps.push("reasoning");
  }
  if (inferVisionCapability(providerId, modelName)) {
    caps.push("vision");
  }
  return caps;
}

function inferVisionCapability(providerId: string, modelName: string): boolean {
  if (isKnownNonVisionChatModel(providerId, modelName)) return false;
  const slug = modelSlug(modelName);
  return /(?:^|[/_-])(?:gpt-4o(?!-mini)|gpt-4-turbo|gpt-4\.1|o1|o3|o4|claude-3|claude-4|gemini|qwen-vl|qwen2\.5-vl|glm-4v|glm-4\.\d+v|glm-4\.1v|4v|5v|vision|vl-|pixtral|llava|moondream|internvl|doubao-vision)/i.test(
    slug
  );
}
