// Plan-Id: machi-kb-stage1-local-mvp
import { useState } from "react";
import { FileSearch, Loader2, Search } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import type { KBConfig, PreviewChunk, RetrievalHit } from "./types";

type Props = {
  api: KBApi;
  config: KBConfig;
};

export function KnowledgeDebugPanel({ api, config }: Props) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<number>(config.retrieval.top_k);
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [previewPath, setPreviewPath] = useState("");
  const [chunkSize, setChunkSize] = useState(config.chunking.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunking.chunk_overlap);
  const [chunks, setChunks] = useState<PreviewChunk[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await api.search(query.trim(), topK);
      setHits(result.hits);
    } catch (exc) {
      setSearchError(String((exc as Error).message ?? exc));
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  async function runPreview() {
    if (!previewPath.trim()) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await api.previewChunks(previewPath.trim(), {
        strategy: config.chunking.strategy,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
      });
      setChunks(result);
    } catch (exc) {
      setPreviewError(String((exc as Error).message ?? exc));
      setChunks([]);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="Top-K 检索调试">
        <div className="flex gap-2">
          <input
            type="text"
            className="kb-debug-input flex-1"
            placeholder="输入问题，例如：知识库默认使用哪个向量库？"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
          />
          <input
            type="number"
            className="kb-debug-input w-20"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(Math.min(20, Math.max(1, Number(e.target.value) || 5)))}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-50"
            onClick={runSearch}
            disabled={!query.trim() || searching}
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            检索
          </button>
        </div>

        {searchError ? (
          <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {searchError}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {hits.length === 0 && !searchError ? (
            <div className="text-xs text-text-subtle">（尚无结果）</div>
          ) : null}
          {hits.map((h, idx) => (
            <div
              key={h.id}
              className="rounded border border-border bg-surface-card/50 p-2 text-xs"
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] text-text-subtle">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
                  #{idx + 1}
                </span>
                <span>score={h.score.toFixed(4)}</span>
                {h.source.chunk_index !== null && h.source.chunk_index !== undefined ? (
                  <span>chunk #{h.source.chunk_index}</span>
                ) : null}
                <span className="truncate" title={h.source.uri}>
                  {h.source.title ?? h.source.uri}
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                {h.text}
              </pre>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="切片预览（不入库）">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            type="text"
            className="kb-debug-input md:col-span-3"
            placeholder="文件绝对路径，如 /Users/me/doc.md"
            value={previewPath}
            onChange={(e) => setPreviewPath(e.target.value)}
          />
          <input
            type="number"
            className="kb-debug-input"
            placeholder="chunk_size"
            value={chunkSize}
            onChange={(e) => setChunkSize(Number(e.target.value) || 800)}
          />
          <input
            type="number"
            className="kb-debug-input"
            placeholder="chunk_overlap"
            value={chunkOverlap}
            onChange={(e) => setChunkOverlap(Number(e.target.value) || 0)}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-50"
            onClick={runPreview}
            disabled={!previewPath.trim() || previewing}
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSearch className="h-3.5 w-3.5" />
            )}
            预览
          </button>
        </div>
        {previewError ? (
          <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {previewError}
          </div>
        ) : null}
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {chunks.map((c) => (
            <div
              key={c.chunk_index}
              className="rounded border border-border bg-surface-card/50 p-2 text-xs"
            >
              <div className="mb-1 text-[11px] text-text-subtle">
                chunk #{c.chunk_index}{c.start_index !== null ? ` · [${c.start_index}, ${c.end_index}]` : ""}
              </div>
              <pre className="whitespace-pre-wrap break-words leading-relaxed">{c.text}</pre>
            </div>
          ))}
          {!previewing && chunks.length === 0 && !previewError ? (
            <div className="text-xs text-text-subtle">（输入本地文件路径后点「预览」）</div>
          ) : null}
        </div>
      </Panel>

      <style>{`
        .kb-debug-input {
          border: 1px solid var(--color-border, #e5e7eb);
          background: var(--color-surface-card, #fff);
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
        }
        .kb-debug-input:focus {
          outline: 2px solid var(--color-accent, #6366f1);
          outline-offset: -1px;
        }
      `}</style>
    </div>
  );
}
