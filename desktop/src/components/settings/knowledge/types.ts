// TypeScript mirror of agenticx/studio/kb/contracts.py — keep in sync.
// Plan-Id: machi-kb-stage1-local-mvp
// Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

export type KBDocumentStatus =
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "writing"
  | "done"
  | "failed";

export type IngestJobStatus = KBDocumentStatus;

export type VectorStoreSpec = {
  backend: "chroma";
  path: string;
  collection: string;
};

export type EmbeddingSpec = {
  provider: string;
  model: string;
  dim: number;
  base_url?: string | null;
  /** Literal API key (preferred). Persisted to ~/.agenticx/config.yaml. */
  api_key?: string | null;
  /** Optional env var NAME (e.g. DASHSCOPE_API_KEY) used as fallback when api_key is empty. */
  api_key_env?: string | null;
};

export type ChunkingSpec = {
  strategy: string;
  chunk_size: number;
  chunk_overlap: number;
};

export type FileFilterSpec = {
  extensions: string[];
  max_file_size_mb: number;
};

export type RetrievalSpec = {
  top_k: number;
  score_floor: number;
  mode: "auto" | "always";
  retrieval_mode?: "vector" | "bm25" | "hybrid" | "hybrid_graph";
  rrf_k?: number;
  bm25_weight?: number;
  vector_weight?: number;
  rerank_enabled?: boolean;
};

export type WikiCompilerSpec = {
  enabled: boolean;
};

export type SynthesisSpec = {
  enabled: boolean;
};

export type KBConfig = {
  enabled: boolean;
  vector_store: VectorStoreSpec;
  embedding: EmbeddingSpec;
  chunking: ChunkingSpec;
  file_filters: FileFilterSpec;
  retrieval: RetrievalSpec;
  wiki_compiler?: WikiCompilerSpec;
  synthesis?: SynthesisSpec;
};

export type KBStats = {
  enabled: boolean;
  doc_count: number;
  indexed_doc_count: number;
  failed_doc_count: number;
  embedding_fingerprint: string;
  indexed_fingerprint: string | null;
  rebuild_required: boolean;
};

export type KBDocument = {
  id: string;
  source_path: string;
  source_name: string;
  size_bytes: number;
  mtime_iso: string;
  status: KBDocumentStatus;
  chunks: number;
  error: string | null;
  added_at: string;
  embedding_fingerprint: string | null;
};

export type IngestJob = {
  id: string;
  document_id: string | null;
  status: IngestJobStatus;
  progress: number;
  message: string;
  report: { success: number; failed: number; reasons: string[] };
  started_at: string | null;
  finished_at: string | null;
};

export type RetrievalHitSource = {
  kind: "local" | "remote";
  uri: string;
  title?: string | null;
  chunk_index?: number | null;
  page?: number | null;
};

export type RetrievalHit = {
  id: string;
  score: number;
  text: string;
  source: RetrievalHitSource;
  metadata: Record<string, unknown>;
  vector_score?: number;
  bm25_score?: number;
  fused_score?: number;
  retrieval_mode?: string;
};

export type PreviewChunk = {
  text: string;
  chunk_index: number;
  start_index: number | null;
  end_index: number | null;
};

/** Normalize API/draft payloads so nested optional flags are always defined. */
export function normalizeKbConfig(config: KBConfig): KBConfig {
  const base = defaultKBConfig();
  return {
    ...base,
    ...config,
    vector_store: { ...base.vector_store, ...config.vector_store },
    embedding: { ...base.embedding, ...config.embedding },
    chunking: { ...base.chunking, ...config.chunking },
    file_filters: { ...base.file_filters, ...config.file_filters },
    retrieval: { ...base.retrieval, ...config.retrieval },
    wiki_compiler: {
      enabled: config.wiki_compiler?.enabled ?? base.wiki_compiler!.enabled,
    },
    synthesis: {
      enabled: config.synthesis?.enabled ?? base.synthesis!.enabled,
    },
  };
}

export function defaultKBConfig(): KBConfig {
  return {
    enabled: false,
    vector_store: {
      backend: "chroma",
      path: "~/.agenticx/storage/vector_db/default",
      collection: "default",
    },
    embedding: {
      provider: "ollama",
      model: "bge-m3",
      dim: 1024,
    },
    chunking: {
      strategy: "recursive",
      chunk_size: 800,
      chunk_overlap: 80,
    },
    file_filters: {
      extensions: [
        ".md",
        ".markdown",
        ".txt",
        ".rst",
        ".log",
        ".pdf",
        ".docx",
        ".pptx",
        ".doc",
        ".ppt",
        ".xls",
        ".xlsx",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".html",
        ".htm",
        ".xml",
        ".json",
        ".csv",
        ".tsv",
        ".yaml",
        ".yml",
      ],
      max_file_size_mb: 100,
    },
    retrieval: {
      top_k: 5,
      score_floor: 0,
      mode: "auto",
      retrieval_mode: "vector",
      rrf_k: 60,
      bm25_weight: 1,
      vector_weight: 1,
      rerank_enabled: false,
    },
    wiki_compiler: { enabled: false },
    synthesis: { enabled: false },
  };
}

export const EMBEDDING_PROVIDERS: { id: string; label: string; defaultModel: string; defaultDim: number }[] = [
  { id: "ollama", label: "Ollama 本地", defaultModel: "bge-m3", defaultDim: 1024 },
  { id: "openai", label: "OpenAI", defaultModel: "text-embedding-3-small", defaultDim: 1536 },
  { id: "siliconflow", label: "SiliconFlow", defaultModel: "BAAI/bge-m3", defaultDim: 1024 },
  // 百炼 text-embedding-v4（Qwen3-Embedding）支持 2048 / 1536 / 1024(默认) / 768 / 512 / 256 / 128 / 64；
  // 与官方默认对齐到 1024，需要更大维度（如 2048）时由用户在表单中手动调整。
  { id: "bailian", label: "Bailian 百炼", defaultModel: "text-embedding-v4", defaultDim: 1024 },
];

export const CHUNKING_STRATEGIES = [
  { id: "recursive", label: "Recursive · 默认" },
  { id: "contextual", label: "Contextual · 标题前缀" },
  { id: "fixed_size", label: "Fixed Size" },
  { id: "document", label: "Document" },
];

export const RETRIEVAL_MODES = [
  { id: "vector", label: "向量" },
  { id: "bm25", label: "关键词 BM25" },
  { id: "hybrid", label: "混合检索 RRF" },
  { id: "hybrid_graph", label: "混合 + 知识图谱" },
] as const;
