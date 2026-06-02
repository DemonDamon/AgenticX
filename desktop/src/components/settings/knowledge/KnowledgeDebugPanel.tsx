// Plan-Id: machi-kb-stage1-local-mvp
import { useState } from "react";
import {
  AlertCircle,
  FileSearch,
  Layers,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import type { KBConfig, PreviewChunk, RetrievalHit } from "./types";
import { KB_FIELD_BASE } from "./kb-field-classes";
import { RETRIEVAL_MODES } from "./types";

type Props = {
  api: KBApi;
  config: KBConfig;
};

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--settings-accent-solid)] px-3 py-2 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:cursor-not-allowed disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-text-subtle">
      <span className="mb-1 inline-block font-medium text-text-muted">{label}</span>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-snug text-text-faint">{hint}</p> : null}
    </label>
  );
}

function DebugAlert({ message }: { message: string }) {
  const isNetwork =
    /failed to fetch|network|ECONNREFUSED|fetch/i.test(message) ||
    message.includes("无法连接");
  return (
    <div
      className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/8 px-3 py-2.5 text-xs text-rose-800 dark:text-rose-200"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-medium leading-snug">{message}</p>
        {isNetwork ? (
          <p className="text-[11px] leading-relaxed text-rose-700/90 dark:text-rose-300/90">
            请确认 Near 已启动本地后端（agx serve），且当前知识库已保存并启用后再试。
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EmptyHint({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Search;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-panel/40 px-4 py-8 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-text-faint">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-text-faint">{detail}</p>
    </div>
  );
}

function ScoreChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-1.5 py-0.5 font-mono text-[10px] text-text-subtle"
      title={label}
    >
      <span className="text-text-faint">{label}</span>
      <span className="text-text-primary">{value}</span>
    </span>
  );
}

function HitCard({ hit, rank }: { hit: RetrievalHit; rank: number }) {
  const mode = hit.retrieval_mode ?? hit.metadata?.retrieval_mode;
  const vec = hit.vector_score ?? hit.metadata?.vector_score;
  const bm25 = hit.bm25_score ?? hit.metadata?.bm25_score;
  const fused = hit.fused_score ?? hit.metadata?.fused_score;
  const sourceTitle = hit.source.title ?? hit.source.uri;
  const chunkIdx = hit.source.chunk_index;

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface-panel/50">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-surface-card/60 px-3 py-2">
        <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-[var(--settings-accent-badge-bg)] px-1.5 text-[11px] font-semibold text-[var(--settings-accent-fg)]">
          {rank}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <ScoreChip label="相关度" value={hit.score.toFixed(4)} />
          {typeof fused === "number" ? (
            <ScoreChip label="融合" value={fused.toFixed(4)} />
          ) : null}
          {typeof vec === "number" ? <ScoreChip label="向量" value={Number(vec).toFixed(4)} /> : null}
          {typeof bm25 === "number" ? (
            <ScoreChip label="BM25" value={Number(bm25).toFixed(4)} />
          ) : null}
          {mode ? (
            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-faint">
              {String(mode)}
            </span>
          ) : null}
        </div>
      </header>
      <div className="space-y-1.5 px-3 py-2">
        <p className="truncate text-[11px] text-text-faint" title={hit.source.uri}>
          {sourceTitle}
          {chunkIdx !== null && chunkIdx !== undefined ? (
            <span className="text-text-subtle"> · 片段 #{chunkIdx}</span>
          ) : null}
        </p>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-surface-card px-2.5 py-2 text-xs leading-relaxed text-text-primary">
          {hit.text}
        </pre>
      </div>
    </article>
  );
}

function ChunkCard({ chunk }: { chunk: PreviewChunk }) {
  const span =
    chunk.start_index !== null && chunk.end_index !== null
      ? `字符 ${chunk.start_index}–${chunk.end_index}`
      : null;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface-panel/50">
      <header className="flex items-center justify-between border-b border-border/80 bg-surface-card/60 px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-muted">片段 #{chunk.chunk_index}</span>
        {span ? <span className="font-mono text-[10px] text-text-faint">{span}</span> : null}
      </header>
      <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-text-primary">
        {chunk.text}
      </pre>
    </article>
  );
}

export function KnowledgeDebugPanel({ api, config }: Props) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<number>(config.retrieval.top_k);
  const [retrievalMode, setRetrievalMode] = useState<string>(
    config.retrieval.retrieval_mode ?? "vector",
  );
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [previewPath, setPreviewPath] = useState("");
  const [chunkSize, setChunkSize] = useState(config.chunking.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunking.chunk_overlap);
  const [chunks, setChunks] = useState<PreviewChunk[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState(false);

  const chunkStrategyLabel =
    config.chunking.strategy === "recursive"
      ? "Recursive"
      : config.chunking.strategy;

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await api.search(query.trim(), topK, retrievalMode);
      setHits(result.hits);
      setSearched(true);
    } catch (exc) {
      setSearchError(String((exc as Error).message ?? exc));
      setHits([]);
      setSearched(true);
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
      setPreviewed(true);
    } catch (exc) {
      setPreviewError(String((exc as Error).message ?? exc));
      setChunks([]);
      setPreviewed(true);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-text-faint">
        在此验证检索质量与切片效果，不会修改已入库资料；配置变更后请先在「配置」页保存。
      </p>

      <Panel
        title="召回调试"
        actions={
          hits.length > 0 ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
              {hits.length} 条
            </span>
          ) : null
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="检索通道">
              <select
                className={`w-full ${KB_FIELD_BASE}`}
                value={retrievalMode}
                onChange={(e) => setRetrievalMode(e.target.value)}
              >
                {RETRIEVAL_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="返回条数 (Top-K)" hint="1–20，与配置页默认值可独立调试">
              <input
                type="number"
                className={`w-full ${KB_FIELD_BASE}`}
                min={1}
                max={20}
                value={topK}
                onChange={(e) =>
                  setTopK(Math.min(20, Math.max(1, Number(e.target.value) || 5)))
                }
              />
            </Field>
          </div>

          <Field label="测试问题" hint="Enter 发送；尽量用完整问句，便于观察召回片段">
            <textarea
              className={`min-h-[72px] w-full resize-y ${KB_FIELD_BASE}`}
              placeholder="例如：知识库默认使用哪个向量库？embedding 维度在哪里配置？"
              value={query}
              rows={2}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void runSearch();
                }
              }}
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={runSearch}
              disabled={!query.trim() || searching}
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {searching ? "检索中…" : "运行检索"}
            </button>
          </div>

          {searchError ? <DebugAlert message={searchError} /> : null}

          <div className="space-y-2">
            {hits.map((h, idx) => (
              <HitCard key={h.id} hit={h} rank={idx + 1} />
            ))}
            {!searching && hits.length === 0 && !searchError && !searched ? (
              <EmptyHint
                icon={Sparkles}
                title="尚未运行检索"
                detail="选择通道、输入问题后点击「运行检索」，将按相关度展示命中的文本片段与来源。"
              />
            ) : null}
            {!searching && hits.length === 0 && searched && !searchError ? (
              <EmptyHint
                icon={Search}
                title="无命中结果"
                detail="可尝试换问法、调大 Top-K、切换混合检索，或确认资料已成功入库。"
              />
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title="切片预览"
        actions={
          chunks.length > 0 ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
              {chunks.length} 段
            </span>
          ) : null
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-text-faint">
            仅解析本地文件并预览分段，<span className="text-text-subtle">不会写入向量库</span>
            。策略沿用配置页：<span className="font-medium text-text-muted">{chunkStrategyLabel}</span>
          </p>

          <Field label="本地文件路径">
            <input
              type="text"
              className={`w-full font-mono text-[11px] ${KB_FIELD_BASE}`}
              placeholder="/Users/me/Documents/note.md"
              value={previewPath}
              onChange={(e) => setPreviewPath(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="切片大小 (字符)" hint="单段最大长度">
              <input
                type="number"
                className={`w-full ${KB_FIELD_BASE}`}
                min={100}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value) || 800)}
              />
            </Field>
            <Field label="重叠长度 (字符)" hint="相邻片段重叠，减少断句">
              <input
                type="number"
                className={`w-full ${KB_FIELD_BASE}`}
                min={0}
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(Number(e.target.value) || 0)}
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={runPreview}
              disabled={!previewPath.trim() || previewing}
            >
              {previewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSearch className="h-3.5 w-3.5" />
              )}
              {previewing ? "解析中…" : "预览切片"}
            </button>
          </div>

          {previewError ? <DebugAlert message={previewError} /> : null}

          <div className="max-h-[min(24rem,50vh)] space-y-2 overflow-y-auto pr-0.5">
            {chunks.map((c) => (
              <ChunkCard key={c.chunk_index} chunk={c} />
            ))}
            {!previewing && chunks.length === 0 && !previewError && !previewed ? (
              <EmptyHint
                icon={Layers}
                title="尚未预览切片"
                detail="填写本机可读的文件绝对路径，调整大小与重叠后点击「预览切片」查看实际分段。"
              />
            ) : null}
            {!previewing && chunks.length === 0 && previewed && !previewError ? (
              <EmptyHint
                icon={FileSearch}
                title="未生成片段"
                detail="请检查路径是否存在、扩展名是否受支持，以及文件是否有可读文本内容。"
              />
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
