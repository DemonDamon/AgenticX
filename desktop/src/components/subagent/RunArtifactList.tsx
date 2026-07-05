/**
 * Sub-Plan D FR-4 —— drawer 末尾的产物列表：文件名 + 落盘绝对路径，点击文件名走
 * `artifact-preview` 内联预览（文本/Markdown），点击「打开」走 `shellOpenPath`
 * 用系统应用打开。
 */
import { useCallback, useState } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { mergeSubAgentOutputPaths } from "../../utils/subagent-output-files";
import { previewBaseName } from "../workspace/workspace-preview-types";
import { CitationMarkdownBody } from "../messages/CitationMarkdownBody";
import { fetchArtifactPreview, type ArtifactPreviewResponse } from "./run-drawer-api";

type Props = {
  apiBase: string;
  apiToken: string;
  sessionId: string;
  runId: string;
  resultFile?: string;
  outputFiles?: string[];
};

type PreviewState =
  | { status: "loading" }
  | { status: "ok"; data: ArtifactPreviewResponse }
  | { status: "error"; error: string };

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function RunArtifactList({ apiBase, apiToken, sessionId, runId, resultFile, outputFiles }: Props) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});

  const paths = mergeSubAgentOutputPaths(resultFile ? [resultFile] : undefined, outputFiles);

  const togglePreview = useCallback(
    (path: string) => {
      setExpandedPath((cur) => (cur === path ? null : path));
      if (previews[path]) return;
      setPreviews((prev) => ({ ...prev, [path]: { status: "loading" } }));
      fetchArtifactPreview(apiBase, apiToken, sessionId, runId, path)
        .then((data) => {
          setPreviews((prev) => ({
            ...prev,
            [path]: data.ok ? { status: "ok", data } : { status: "error", error: data.error || "预览失败" },
          }));
        })
        .catch((err) => {
          setPreviews((prev) => ({ ...prev, [path]: { status: "error", error: String(err) } }));
        });
    },
    [apiBase, apiToken, sessionId, runId, previews],
  );

  const openInSystem = useCallback(async (path: string) => {
    const open = window.agenticxDesktop?.shellOpenPath;
    if (!open) return;
    const result = await open(path);
    if (!result.ok) {
      console.warn("[RunArtifactList] open file failed:", result.error);
    }
  }, []);

  if (paths.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-border p-2.5">
      <div className="px-0.5 text-[11px] font-medium text-text-muted">产物</div>
      {paths.map((path) => {
        const expanded = expandedPath === path;
        const preview = previews[path];
        return (
          <div key={path} className="overflow-hidden rounded-lg border border-border bg-surface-card">
            <div className="flex items-center gap-2 px-2.5 py-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.5} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[12px] text-text-strong hover:underline"
                onClick={() => togglePreview(path)}
                title={path}
              >
                {previewBaseName(path)}
              </button>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void openInSystem(path)}
                title="用系统应用打开"
              >
                <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                打开
              </button>
            </div>
            <div className="truncate px-2.5 pb-2 font-mono text-[10.5px] text-text-faint" title={path}>
              {path}
            </div>
            {expanded ? (
              <div className="max-h-64 overflow-y-auto border-t border-border px-2.5 py-2">
                {!preview || preview.status === "loading" ? (
                  <div className="text-[11px] text-text-faint">加载中…</div>
                ) : preview.status === "error" ? (
                  <div className="text-[11px] text-[var(--status-error)]">{preview.error}</div>
                ) : preview.data.kind === "binary" ? (
                  <div className="text-[11px] text-text-muted">
                    {preview.data.open_hint || "该文件不支持内联预览，请用系统应用打开"}
                  </div>
                ) : preview.data.text != null ? (
                  isMarkdownPath(path) ? (
                    <CitationMarkdownBody content={preview.data.text} />
                  ) : (
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-primary">
                      {preview.data.text}
                    </pre>
                  )
                ) : null}
                {preview?.status === "ok" && preview.data.kind === "text" && preview.data.truncated ? (
                  <div className="mt-1.5 text-[10.5px] text-[var(--status-warning)]">
                    {preview.data.open_hint || "文件过大，已截断显示"}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
