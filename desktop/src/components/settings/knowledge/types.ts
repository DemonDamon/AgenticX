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
};

export type KBConfig = {
  enabled: boolean;
  vector_store: VectorStoreSpec;
  embedding: EmbeddingSpec;
  chunking: ChunkingSpec;
  file_filters: FileFilterSpec;
  retrieval: RetrievalSpec;
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
};

export type PreviewChunk = {
  text: string;
  chunk_index: number;
  start_index: number | null;
  end_index: number | null;
};

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
      extensions: [".md", ".txt", ".pdf", ".docx"],
      max_file_size_mb: 100,
    },
    retrieval: {
      top_k: 5,
      score_floor: 0,
    },
  };
}

export const EMBEDDING_PROVIDERS: { id: string; label: string; defaultModel: string; defaultDim: number }[] = [
  { id: "ollama", label: "Ollama (local)", defaultModel: "bge-m3", defaultDim: 1024 },
  { id: "openai", label: "OpenAI", defaultModel: "text-embedding-3-small", defaultDim: 1536 },
  { id: "siliconflow", label: "SiliconFlow", defaultModel: "BAAI/bge-m3", defaultDim: 1024 },
  { id: "bailian", label: "Bailian (DashScope)", defaultModel: "text-embedding-v2", defaultDim: 1536 },
];

export const CHUNKING_STRATEGIES = [
  { id: "recursive", label: "Recursive (默认)" },
  { id: "fixed_size", label: "Fixed Size" },
  { id: "document", label: "Document" },
];
