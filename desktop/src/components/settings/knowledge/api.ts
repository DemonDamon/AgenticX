// Plan-Id: machi-kb-stage1-local-mvp
// Thin fetch helpers that reuse the studio API base + desktop token.

import type {
  EmbeddingSpec,
  IngestJob,
  KBConfig,
  KBDocument,
  KBStats,
  PreviewChunk,
  RetrievalHit,
} from "./types";

export type EmbeddingTestResult = {
  ok: boolean;
  stage: "build" | "embed" | "dim_mismatch" | "done";
  provider?: string;
  model?: string;
  expected_dim?: number;
  actual_dim?: number;
  latency_ms?: number;
  error?: string | null;
};

export type ParserStatus = {
  ok: boolean;
  liteparse: {
    available: boolean;
    version: string | null;
    path: string | null;
  };
  libreoffice?: {
    available: boolean;
    path: string | null;
    required_for: string[];
    install_hint: string;
  };
  native_ready: boolean;
  install_hint: string;
};

export type KBApi = {
  readConfig: () => Promise<{ config: KBConfig; stats: KBStats }>;
  writeConfig: (
    config: KBConfig,
  ) => Promise<{ config: KBConfig; rebuild_required: boolean }>;
  listDocuments: () => Promise<KBDocument[]>;
  addDocumentByPath: (path: string) => Promise<{ document: KBDocument; job_id: string }>;
  addDocumentByFile: (file: File) => Promise<{ document: KBDocument; job_id: string }>;
  deleteDocument: (id: string) => Promise<void>;
  rebuildDocument: (id: string) => Promise<{ job_id: string }>;
  getJob: (id: string) => Promise<IngestJob>;
  search: (query: string, topK?: number) => Promise<{ hits: RetrievalHit[]; used_top_k: number }>;
  previewChunks: (
    path: string,
    chunking: { strategy: string; chunk_size: number; chunk_overlap: number },
  ) => Promise<PreviewChunk[]>;
  getStats: () => Promise<KBStats>;
  testEmbedding: (embedding: EmbeddingSpec) => Promise<EmbeddingTestResult>;
  getParserStatus: () => Promise<ParserStatus>;
};

type ResolveBase = () => Promise<string>;

export function createKbApi(apiToken: string, resolveApiBase: ResolveBase): KBApi {
  async function doJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = await resolveApiBase();
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined ?? {}),
    };
    if (apiToken) headers["x-agx-desktop-token"] = apiToken;
    if (init.body && !(init.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let detail: string;
      try {
        const body = await res.json();
        detail = String(body?.detail ?? body?.error ?? res.statusText);
      } catch {
        detail = res.statusText;
      }
      throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as T;
  }

  return {
    async readConfig() {
      const body = await doJson<{ config: KBConfig; stats: KBStats }>(`/api/kb/config`);
      return body;
    },
    async writeConfig(config: KBConfig) {
      const body = await doJson<{ config: KBConfig; rebuild_required: boolean }>(
        `/api/kb/config`,
        { method: "PUT", body: JSON.stringify(config) },
      );
      return body;
    },
    async listDocuments() {
      const body = await doJson<{ documents: KBDocument[] }>(`/api/kb/documents`);
      return body.documents;
    },
    async addDocumentByPath(path: string) {
      const form = new FormData();
      form.append("path", path);
      return doJson<{ document: KBDocument; job_id: string }>(`/api/kb/documents`, {
        method: "POST",
        body: form,
      });
    },
    async addDocumentByFile(file: File) {
      const form = new FormData();
      form.append("file", file, file.name);
      return doJson<{ document: KBDocument; job_id: string }>(`/api/kb/documents`, {
        method: "POST",
        body: form,
      });
    },
    async deleteDocument(id: string) {
      await doJson(`/api/kb/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async rebuildDocument(id: string) {
      return doJson<{ job_id: string }>(`/api/kb/documents/${encodeURIComponent(id)}/rebuild`, {
        method: "POST",
      });
    },
    async getJob(id: string) {
      const body = await doJson<{ job: IngestJob }>(`/api/kb/jobs/${encodeURIComponent(id)}`);
      return body.job;
    },
    async search(query: string, topK?: number) {
      const body = await doJson<{ hits: RetrievalHit[]; used_top_k: number }>(`/api/kb/search`, {
        method: "POST",
        body: JSON.stringify({ query, top_k: topK }),
      });
      return body;
    },
    async previewChunks(path, chunking) {
      const body = await doJson<{ chunks: PreviewChunk[] }>(`/api/kb/debug/preview`, {
        method: "POST",
        body: JSON.stringify({ path, chunking }),
      });
      return body.chunks;
    },
    async getStats() {
      const body = await doJson<{ stats: KBStats }>(`/api/kb/stats`);
      return body.stats;
    },
    async testEmbedding(embedding: EmbeddingSpec) {
      return doJson<EmbeddingTestResult>(`/api/kb/test_embedding`, {
        method: "POST",
        body: JSON.stringify({ embedding }),
      });
    },
    async getParserStatus() {
      return doJson<ParserStatus>(`/api/kb/parser_status`);
    },
  };
}
