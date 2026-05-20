export type CodeIndexSembleConfig = {
  search_mode: "hybrid" | "semantic" | "bm25";
  default_top_k: number;
  include_text_files: boolean;
  model: string;
};

export type CodeIndexConfig = {
  enabled: boolean;
  backend: string;
  preload_model: boolean;
  max_index_memory_mb: number;
  semble: CodeIndexSembleConfig;
};

export type CodeIndexTaskStatus = {
  status: string;
  files_total: number;
  files_done: number;
  total_chunks: number;
  languages: Record<string, number>;
  error_summary?: string | null;
  codebase_path: string;
  task_id: string;
};

export const defaultCodeIndexConfig = (): CodeIndexConfig => ({
  enabled: false,
  backend: "semble",
  preload_model: false,
  max_index_memory_mb: 1024,
  semble: {
    search_mode: "hybrid",
    default_top_k: 10,
    include_text_files: false,
    model: "minishlab/potion-code-16M",
  },
});
