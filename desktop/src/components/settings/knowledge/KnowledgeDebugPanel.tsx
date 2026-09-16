// Plan-Id: machi-kb-stage1-local-mvp
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {

  AlertCircle,
  FileSearch,
  Layers,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import type { KBApi } from "./api";
import type { KBConfig, PreviewChunk, RetrievalHit } from "./types";
import { KB_FIELD_BASE } from "./kb-field-classes";
import { RETRIEVAL_MODES } from "./types";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}

function retrievalModeLabel(id: string): string {
  const keys: Record<string, string> = {
    vector: "knowledge.retVector",
    bm25: "knowledge.retBm25",
    hybrid: "knowledge.retHybrid",
    hybrid_graph: "knowledge.retHybridGraph",
  };
  return keys[id] ? st(keys[id]) : id;
}


type Props = {
  api: KBApi;
  config: KBConfig;
};

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--settings-accent-solid)] px-3 py-2 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:cursor-not-allowed disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${SETTINGS_LABEL_CLASS}`}>
      <span className="mb-1 inline-block">{label}</span>
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
            {st("knowledge.networkHint")}
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
          <ScoreChip label={st("knowledge.scoreRel")} value={hit.score.toFixed(4)} />
          {typeof fused === "number" ? (
            <ScoreChip label={st("knowledge.scoreFused")} value={fused.toFixed(4)} />
          ) : null}
          {typeof vec === "number" ? <ScoreChip label={st("knowledge.scoreVec")} value={Number(vec).toFixed(4)} /> : null}
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
            <span className="text-text-subtle"> · {st("knowledge.chunkHash", { n: chunkIdx })}</span>
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
      ? st("knowledge.charRange", { start: chunk.start_index, end: chunk.end_index })
      : null;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface-panel/50">
      <header className="flex items-center justify-between border-b border-border/80 bg-surface-card/60 px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-muted">{st("knowledge.chunkHash", { n: chunk.chunk_index })}</span>
        {span ? <span className="font-mono text-[10px] text-text-faint">{span}</span> : null}
      </header>
      <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-text-primary">
        {chunk.text}
      </pre>
    </article>
  );
}

export function KnowledgeDebugPanel({ api, config }: Props) {
  const { t } = useTranslation("settings");
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
        {st("knowledge.debugIntro")}
      </p>

      <Panel
        title={st("knowledge.recallTitle")}
        actions={
          hits.length > 0 ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
              {st("knowledge.hitsCount", { count: hits.length })}
            </span>
          ) : null
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={st("knowledge.channel")}>
              <select
                className={`w-full ${KB_FIELD_BASE}`}
                value={retrievalMode}
                onChange={(e) => setRetrievalMode(e.target.value)}
              >
                {RETRIEVAL_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {retrievalModeLabel(m.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={st("knowledge.topK")} hint={st("knowledge.topKHint")}>
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

          <Field label={st("knowledge.testQuestion")} hint={st("knowledge.testQuestionHint")}>
            <textarea
              className={`min-h-[72px] w-full resize-y ${KB_FIELD_BASE}`}
              placeholder={st("knowledge.testQuestionPh")}
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
              {searching ? st("knowledge.searching") : st("knowledge.runSearch")}
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
                title={st("knowledge.noSearchYet")}
                detail={st("knowledge.noSearchDetail")}
              />
            ) : null}
            {!searching && hits.length === 0 && searched && !searchError ? (
              <EmptyHint
                icon={Search}
                title={st("knowledge.noHits")}
                detail={st("knowledge.noHitsDetail")}
              />
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title={st("knowledge.chunkPreview")}
        actions={
          chunks.length > 0 ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
              {st("knowledge.chunkCount", { count: chunks.length })}
            </span>
          ) : null
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-text-faint">
            {st("knowledge.chunkLocalOnly", { strategy: chunkStrategyLabel })}
          </p>

          <Field label={st("knowledge.localPath")}>
            <input
              type="text"
              className={`w-full font-mono text-[11px] ${KB_FIELD_BASE}`}
              placeholder="/Users/me/Documents/note.md"
              value={previewPath}
              onChange={(e) => setPreviewPath(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={st("knowledge.chunkSize")} hint={st("knowledge.chunkSizeHint")}>
              <input
                type="number"
                className={`w-full ${KB_FIELD_BASE}`}
                min={100}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value) || 800)}
              />
            </Field>
            <Field label={st("knowledge.overlap")} hint={st("knowledge.overlapHint")}>
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
              {previewing ? st("knowledge.previewing") : st("knowledge.previewChunks")}
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
                title={st("knowledge.noPreviewYet")}
                detail={st("knowledge.noPreviewDetail")}
              />
            ) : null}
            {!previewing && chunks.length === 0 && previewed && !previewError ? (
              <EmptyHint
                icon={FileSearch}
                title={st("knowledge.noChunks")}
                detail={st("knowledge.noChunksDetail")}
              />
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
