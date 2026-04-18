// Plan-Id: machi-kb-stage1-local-mvp
import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import type { IngestJob, KBDocument, KBDocumentStatus } from "./types";

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
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Record<string, ActiveJob>>({});
  const dropRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const docs = await api.listDocuments();
      setDocuments(docs);
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
      if (anyTerminal) void reload();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [activeJobs, api, reload]);

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
      知识库当前未启用，请先到「配置」面板启用后再添加资料。
    </div>
  ) : null;

  return (
    <div className="space-y-3">
      {disabledHint}
      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <Panel
        title="资料上传"
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
            onClick={() => void reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        }
      >
        <div
          ref={dropRef}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-sm transition ${
            enabled ? "border-border hover:border-accent" : "border-border/50 opacity-60"
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
            拖拽文件到此处，或点击选择（支持 {extensions.join(", ") || "MD/TXT/PDF/DOCX"}）
          </div>
        </div>
      </Panel>

      <Panel title={`已加入资料 (${documents.length})`}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-subtle">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : documents.length === 0 ? (
          <div className="text-sm text-text-subtle">
            空。拖入一个 Markdown 文件即可开始第一次检索。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((doc) => {
              const job = activeJobs[doc.id];
              const status = job?.status ?? doc.status;
              const progressPercent = Math.round((job?.progress ?? 0) * 100);
              return (
                <li key={doc.id} className="flex items-start gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={doc.source_path}>
                      {doc.source_name}
                    </div>
                    <div className="mt-0.5 text-xs text-text-subtle">
                      <span className={statusTagClass(status)}>{statusLabel(status)}</span>
                      <span className="ml-2">{formatSize(doc.size_bytes)}</span>
                      <span className="ml-2">片段: {doc.chunks}</span>
                      <span className="ml-2 truncate" title={doc.source_path}>
                        {doc.source_path}
                      </span>
                    </div>
                    {doc.error ? (
                      <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                        {doc.error}
                      </div>
                    ) : null}
                    {job && status !== "done" && status !== "failed" ? (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs"
                      onClick={() => rebuild(doc.id)}
                      disabled={!enabled || Boolean(job)}
                      title="重建索引"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-rose-600"
                      onClick={() => remove(doc.id)}
                      disabled={Boolean(job)}
                      title="删除"
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

function statusLabel(status: KBDocumentStatus): string {
  const map: Record<KBDocumentStatus, string> = {
    queued: "排队中",
    parsing: "解析中",
    chunking: "切片中",
    embedding: "向量化",
    writing: "写入中",
    done: "已索引",
    failed: "失败",
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
