// Plan-Id: machi-kb-stage1-local-mvp
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import type { IngestJob, KBDocument, KBDocumentStatus } from "./types";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type Props = {
  api: KBApi;
  enabled: boolean;
  extensions: string[];
};

type ActiveJob = {
  docId: string;
  jobId: string;
  status: KBDocumentStatus;
  progress: number;
  message: string;
};

const POLL_INTERVAL_MS = 800;

export function KnowledgeMaterialsPanel({ api, enabled, extensions }: Props) {
  const { t } = useTranslation("settings");
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Record<string, ActiveJob>>({});
  /** null = checking; true = chromadb/PDF/SOCKS deps importable in backend Python */
  const [backendDepsReady, setBackendDepsReady] = useState<boolean | null>(null);
  const [depsMissing, setDepsMissing] = useState<string[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  const refreshBackendDeps = useCallback(async () => {
    try {
      const r = await window.agenticxDesktop.diagnoseBackendDeps();
      const missing = r.missing ?? [];
      setDepsMissing(missing);
      setBackendDepsReady(missing.length === 0 && r.ok !== false);
    } catch {
      setDepsMissing([st("knowledge.depsDetectFailed")]);
      setBackendDepsReady(false);
    }
  }, []);

  useEffect(() => {
    void refreshBackendDeps();
  }, [refreshBackendDeps]);

  const reload = useCallback(async () => {
    try {
      // Fetch docs + active jobs in parallel. Jobs live in the backend's
      // in-process JobRegistry (ThreadPoolExecutor) and keep running when
      // the settings panel is closed, but their ids are lost once this
      // component unmounts. Re-hydrating `activeJobs` from the backend
      // lets the polling effect resume and restores the live progress
      // bar instead of getting stuck on the coarse persisted status
      // (e.g. showing st("knowledge.stQueued") while ingestion is actually at 70%).
      const [docs, jobs] = await Promise.all([
        api.listDocuments(),
        api.listJobs().catch(() => [] as IngestJob[]),
      ]);
      setDocuments(docs);
      setActiveJobs((prev) => {
        const next = { ...prev };
        // Keep only the freshest non-terminal job per document.
        const byDoc = new Map<string, IngestJob>();
        for (const j of jobs) {
          if (!j.document_id) continue;
          if (j.status === "done" || j.status === "failed") continue;
          const existing = byDoc.get(j.document_id);
          if (!existing) {
            byDoc.set(j.document_id, j);
            continue;
          }
          // Prefer the most recently started job if multiple are tracked.
          const a = existing.started_at ?? "";
          const b = j.started_at ?? "";
          if (b > a) byDoc.set(j.document_id, j);
        }
        for (const [docId, j] of byDoc) {
          const cur = next[docId];
          // Do not overwrite a locally-issued "queued" placeholder before
          // the backend has registered the job (brief race); otherwise
          // always reflect the backend's latest view.
          if (cur && cur.jobId === j.id) continue;
          next[docId] = {
            docId,
            jobId: j.id,
            status: j.status,
            progress: j.progress,
            message: j.message,
          };
        }
        return next;
      });
      setError(null);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Poll active jobs until terminal. Wrapping in a single interval keeps N small.
  useEffect(() => {
    if (Object.keys(activeJobs).length === 0) return;
    const iv = setInterval(async () => {
      const next: Record<string, ActiveJob> = { ...activeJobs };
      let changed = false;
      let anyTerminal = false;
      for (const key of Object.keys(activeJobs)) {
        const cur = activeJobs[key];
        try {
          const job = await api.getJob(cur.jobId);
          if (
            job.status !== cur.status ||
            Math.abs(job.progress - cur.progress) > 0.01 ||
            job.message !== cur.message
          ) {
            changed = true;
            next[key] = { ...cur, status: job.status, progress: job.progress, message: job.message };
          }
          if (job.status === "done" || job.status === "failed") {
            anyTerminal = true;
            delete next[key];
            changed = true;
          }
        } catch {
          // swallow transient poll failures; the interval will retry
        }
      }
      if (changed) setActiveJobs(next);
      if (anyTerminal) {
        void reload();
        void refreshBackendDeps();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [activeJobs, api, reload, refreshBackendDeps]);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { document, job_id } = await api.addDocumentByFile(file);
      setActiveJobs((prev) => ({
        ...prev,
        [document.id]: {
          docId: document.id,
          jobId: job_id,
          status: "queued",
          progress: 0,
          message: "",
        },
      }));
      setDocuments((prev) => [document, ...prev.filter((d) => d.id !== document.id)]);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setUploading(false);
    }
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!enabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const f of files) {
      await uploadFile(f);
    }
  }

  async function pickFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = extensions.join(",");
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      for (const f of files) {
        await uploadFile(f);
      }
    };
    input.click();
  }

  async function rebuild(docId: string) {
    try {
      const { job_id } = await api.rebuildDocument(docId);
      setActiveJobs((prev) => ({
        ...prev,
        [docId]: {
          docId,
          jobId: job_id,
          status: "queued",
          progress: 0,
          message: "",
        },
      }));
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    }
  }

  async function remove(docId: string) {
    try {
      await api.deleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    }
  }

  const disabledHint = !enabled ? (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      {st("knowledge.notEnabled")}
    </div>
  ) : null;

  const hasRuntimeIngestError = documents.some(
    (d) => d.error && isDesktopRuntimeIngestError(d.error),
  );
  // 依赖已安装（磁盘上检测就绪）但仍有运行期失败 → 多半是当前后端进程在依赖
  // 安装之前启动，Python 进程看不到后装入的包，必须完全重启 Near。
  const depsInstalledButStale =
    backendDepsReady === true && depsMissing.length === 0 && hasRuntimeIngestError;
  const showDepsBanner =
    backendDepsReady === false || depsMissing.length > 0 || hasRuntimeIngestError;

  return (
    <div className="space-y-3">
      {showDepsBanner ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          {depsInstalledButStale ? (
            <>
              <p className="font-medium">{st("knowledge.restartNeededTitle")}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-100/90">
                {st("knowledge.restartNeededBody")}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">
                {st("knowledge.pyEnvIncomplete")}
                {depsMissing.length > 0 ? `：${depsMissing.join("、")}` : ""}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-100/90">
                {st("knowledge.pyEnvHint")}
              </p>
            </>
          )}
        </div>
      ) : null}
      {disabledHint}
      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <Panel
        title={st("knowledge.uploadTitle")}
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
            onClick={() => void reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {st("knowledge.refresh")}
          </button>
        }
      >
        <div
          ref={dropRef}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-sm transition ${
            enabled
              ? "border-border hover:border-[var(--settings-accent-border-strong)]"
              : "border-border/50 opacity-60"
          }`}
          onDragOver={(e) => {
            if (!enabled) return;
            e.preventDefault();
          }}
          onDrop={onDrop}
          onClick={() => {
            if (!enabled) return;
            void pickFiles();
          }}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
          ) : (
            <FilePlus className="h-5 w-5 text-text-subtle" />
          )}
          <div className="mt-2 text-text-subtle">
            {st("knowledge.dropHint", { extensions: extensions.join(", ") || st("knowledge.dropHintDefault") })}
          </div>
        </div>
      </Panel>

      <Panel title={st("knowledge.docsTitle", { count: documents.length })}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-subtle">
            <Loader2 className="h-4 w-4 animate-spin" /> {st("knowledge.loading")}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-sm text-text-subtle">
            {st("knowledge.emptyDocs")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((doc) => {
              const job = activeJobs[doc.id];
              const status = job?.status ?? doc.status;
              const progressPercent = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));
              const isRunning = Boolean(job && status !== "done" && status !== "failed");
              return (
                <li key={doc.id} className="flex min-w-0 items-start gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="truncate font-medium" title={doc.source_name}>
                      {doc.source_name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-subtle">
                      <span className={statusTagClass(status)}>{statusLabel(status)}</span>
                      {isRunning ? <span>{progressPercent}%</span> : null}
                      <span>{formatSize(doc.size_bytes)}</span>
                      <span>{st("knowledge.chunks", { count: doc.chunks })}</span>
                    </div>
                    <div
                      className="mt-1 min-w-0 truncate font-mono text-[11px] leading-snug text-text-faint"
                      title={doc.source_path}
                    >
                      {doc.source_path}
                    </div>
                    {doc.error ? (
                      <div className="mt-1 break-words text-xs text-rose-600 dark:text-rose-400">
                        {doc.error}
                        {isDesktopRuntimeIngestError(doc.error) ? (
                          <p className="mt-1 text-amber-600 dark:text-amber-400">
                            {backendDepsReady === false
                              ? st("knowledge.reindexNeedRepair")
                              : backendDepsReady === true
                                ? st("knowledge.reindexNeedRestart")
                                : st("knowledge.checkingDeps")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {isRunning ? (
                      <>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                          <div
                            className="h-full bg-[var(--settings-accent-progress)] transition-all"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        {job?.message ? (
                          <div className="mt-1 truncate text-[11px] text-text-faint" title={job.message}>
                            {job.message}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs"
                      onClick={() => rebuild(doc.id)}
                      disabled={!enabled || Boolean(job)}
                      title={st("knowledge.reindexTitle")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-rose-600"
                      onClick={() => remove(doc.id)}
                      disabled={Boolean(job)}
                      title={st("knowledge.deleteTitle")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function isDesktopRuntimeIngestError(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("no pdf library") ||
    t.includes("chromadb is required") ||
    t.includes("onnxruntime python package is not installed") ||
    t.includes("socksio") ||
    t.includes("httpx[socks]") ||
    t.includes("socks proxy")
  );
}

function statusLabel(status: KBDocumentStatus): string {
  const map: Record<KBDocumentStatus, string> = {
    queued: st("knowledge.stQueued"),
    parsing: st("knowledge.stParsing"),
    chunking: st("knowledge.stChunking"),
    embedding: st("knowledge.stEmbedding"),
    writing: st("knowledge.stWriting"),
    done: st("knowledge.stDone"),
    failed: st("knowledge.stFailed"),
  };
  return map[status] ?? status;
}

function statusTagClass(status: KBDocumentStatus): string {
  const base = "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide";
  switch (status) {
    case "done":
      return `${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`;
    case "failed":
      return `${base} bg-rose-500/15 text-rose-700 dark:text-rose-300`;
    default:
      return `${base} bg-blue-500/15 text-blue-700 dark:text-blue-300`;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
