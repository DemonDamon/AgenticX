/**
 * Classify a model id into a coarse capability kind, used to render badges in
 * the model service settings (chat vs embedding vs multimodal embedding).
 *
 * Mirrors the embedding catalog merged in the main process `fetch-models`
 * handler so the UI can tag DashScope/Bailian vector models with an "嵌入"
 * badge even though the OpenAI-compatible `/models` endpoint does not list
 * them. Keep the two lists in sync.
 */

export type ModelKind = "chat" | "embedding" | "multimodal_embedding";

/** Bailian text embedding SKUs (DashScope `/embeddings`). */
const BAILIAN_TEXT_EMBEDDING = [
  "text-embedding-v1",
  "text-embedding-v2",
  "text-embedding-v3",
  "text-embedding-v4",
];

/** Bailian multimodal embedding SKUs (text/image/video into one vector space). */
const BAILIAN_MULTIMODAL_EMBEDDING = [
  "multimodal-embedding-v1",
  "qwen3-vl-embedding",
  "qwen2.5-vl-embedding",
  "tongyi-embedding-vision-plus",
  "tongyi-embedding-vision-flash",
  "tongyi-embedding-vision-plus-2026-03-06",
  "tongyi-embedding-vision-flash-2026-03-06",
];

const BAILIAN_TEXT_EMBEDDING_SET = new Set(BAILIAN_TEXT_EMBEDDING);
const BAILIAN_MULTIMODAL_EMBEDDING_SET = new Set(BAILIAN_MULTIMODAL_EMBEDDING);

function slugOf(model: string): string {
  const m = (model || "").trim().toLowerCase();
  return m.includes("/") ? (m.split("/").pop() ?? m) : m;
}

/**
 * Returns the coarse kind for a model id. Empty / unknown ids fall back to
 * "chat" so existing UI (reasoning + tool badges) keeps rendering.
 */
export function classifyModelKind(_provider: string, model: string): ModelKind {
  const slug = slugOf(model);
  if (!slug) return "chat";

  if (BAILIAN_MULTIMODAL_EMBEDDING_SET.has(slug)) return "multimodal_embedding";
  if (BAILIAN_TEXT_EMBEDDING_SET.has(slug)) return "embedding";

  // Generic heuristics for OpenAI/SiliconFlow/etc. embedding SKUs.
  if (/(vl|vision|multimodal)[-_]?embedding|embedding[-_]?vision/.test(slug)) {
    return "multimodal_embedding";
  }
  if (/embedding|bge-|gte-|e5-|text-embedding/.test(slug)) {
    return "embedding";
  }
  return "chat";
}

export function isEmbeddingModelKind(kind: ModelKind): boolean {
  return kind === "embedding" || kind === "multimodal_embedding";
}
