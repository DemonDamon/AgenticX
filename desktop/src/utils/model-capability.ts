/**
 * Model capability inference for provider catalog (chat vs embedding vs reasoning).
 * Aligns with Bailian docs under docs/thrdparty/阿里百炼-*.
 */

export type ModelKind = "chat" | "embedding" | "multimodal_embedding" | "reasoning";

export type ModelKindMeta = {
  kind: ModelKind;
  /** Short UI label, e.g. 嵌入 */
  label?: string;
};

/** Text + multimodal embedding SKUs documented for DashScope / Bailian. */
export const BAILIAN_DOCUMENTED_EMBEDDING_MODELS: readonly string[] = [
  "text-embedding-v4",
  "text-embedding-v3",
  "text-embedding-v2",
  "text-embedding-v1",
  "multimodal-embedding-v1",
  "qwen3-vl-embedding",
  "qwen2.5-vl-embedding",
  "tongyi-embedding-vision-plus-2026-03-06",
  "tongyi-embedding-vision-flash-2026-03-06",
  "tongyi-embedding-vision-plus",
  "tongyi-embedding-vision-flash",
] as const;

const REASONING_RE =
  /(?:^|\/)(?:deepseek-r1|.*-r1(?:-|$)|.*reasoner.*|.*-thinking(?:-|$)|qwq(?:-|$))/i;

const TEXT_EMBEDDING_RE = /^text-embedding(?:-|$)/i;
const MULTIMODAL_EMBEDDING_RE =
  /^(?:multimodal-embedding|qwen[\d.]*-vl-embedding|qwen2\.5-vl-embedding|tongyi-embedding-vision)/i;
const GENERIC_EMBEDDING_RE = /(?:^|[-_/])(?:embedding|embed)(?:[-_/]|$)/i;

export function isBailianLikeProvider(provider: string, baseUrl?: string): boolean {
  const p = (provider || "").trim().toLowerCase();
  if (p === "bailian" || p === "dashscope" || p === "aliyun") return true;
  const u = (baseUrl || "").toLowerCase();
  return u.includes("dashscope.aliyuncs.com");
}

export function modelSlug(modelId: string): string {
  const m = (modelId || "").trim();
  const lower = m.toLowerCase();
  return lower.includes("/") ? (lower.split("/").pop() ?? lower) : lower;
}

export function inferModelKind(provider: string, modelId: string): ModelKindMeta {
  const slug = modelSlug(modelId);
  if (!slug) return { kind: "chat" };

  if (TEXT_EMBEDDING_RE.test(slug)) {
    return { kind: "embedding", label: "嵌入" };
  }
  if (MULTIMODAL_EMBEDDING_RE.test(slug)) {
    return { kind: "multimodal_embedding", label: "嵌入" };
  }
  if (GENERIC_EMBEDDING_RE.test(slug) && !/chat|coder|vl-plus(?!-embedding)/i.test(slug)) {
    return { kind: "embedding", label: "嵌入" };
  }
  if (REASONING_RE.test(slug) || REASONING_RE.test(modelId)) {
    return { kind: "reasoning", label: "推理" };
  }

  if (isBailianLikeProvider(provider) && BAILIAN_DOCUMENTED_EMBEDDING_MODELS.includes(slug as (typeof BAILIAN_DOCUMENTED_EMBEDDING_MODELS)[number])) {
    const kind = slug.startsWith("text-embedding") ? "embedding" : "multimodal_embedding";
    return { kind, label: "嵌入" };
  }

  return { kind: "chat" };
}

export function isEmbeddingModelKind(kind: ModelKind): boolean {
  return kind === "embedding" || kind === "multimodal_embedding";
}

/** Merge API /models ids with documented Bailian embedding SKUs when catalog is incomplete. */
export function mergeProviderFetchedModels(
  provider: string,
  baseUrl: string | undefined,
  apiModelIds: string[],
): { models: string[]; kinds: Record<string, ModelKind> } {
  const kinds: Record<string, ModelKind> = {};
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (id: string) => {
    const trimmed = String(id).trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
    kinds[trimmed] = inferModelKind(provider, trimmed).kind;
  };

  for (const id of apiModelIds) push(id);

  if (isBailianLikeProvider(provider, baseUrl)) {
    for (const id of BAILIAN_DOCUMENTED_EMBEDDING_MODELS) push(id);
  }

  ordered.sort((a, b) => a.localeCompare(b));
  return { models: ordered, kinds };
}

export function modelKindLabel(kind: ModelKind, slug?: string): string {
  if (kind === "embedding" || kind === "multimodal_embedding") {
    if (slug && MULTIMODAL_EMBEDDING_RE.test(slug)) return "嵌入";
    return "嵌入";
  }
  if (kind === "reasoning") return "推理";
  return "";
}
