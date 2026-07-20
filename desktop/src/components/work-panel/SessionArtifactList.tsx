/**
 * Session-level task artifact list for WorkPanel summary tab.
 *
 * Author: Damon Li
 */

import { useEffect, useRef } from "react";
import { Eye, FileText, FolderOpen, ExternalLink } from "lucide-react";
import {
  artifactBaseName,
  isInAppArtifactPreviewPath,
  isInAppHtmlPreviewPath,
} from "../../utils/session-artifacts";

type Props = {
  paths: string[];
  highlightPath?: string | null;
  onHighlightHandled?: () => void;
  /** Open / preview a path (HTML → WorkPanel browser; other previewable → WorkspaceFilePreview). */
  onOpenPath?: (path: string) => void;
};

export function SessionArtifactList({
  paths,
  highlightPath,
  onHighlightHandled,
  onOpenPath,
}: Props) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const target = String(highlightPath || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!target) return;
    const exact = rowRefs.current[target];
    const prefixMatch = !exact
      ? paths.find((p) => p === target || p.startsWith(`${target}/`))
      : null;
    const el = exact ?? (prefixMatch ? rowRefs.current[prefixMatch] : null);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.classList.add("ring-1", "ring-[var(--ui-btn-primary-bg,#3b82f6)]");
      const timer = window.setTimeout(() => {
        el.classList.remove("ring-1", "ring-[var(--ui-btn-primary-bg,#3b82f6)]");
      }, 1600);
      onHighlightHandled?.();
      return () => window.clearTimeout(timer);
    }
    onHighlightHandled?.();
    return undefined;
  }, [highlightPath, paths, onHighlightHandled]);

  const openPath = (path: string) => {
    if (onOpenPath) {
      onOpenPath(path);
      return;
    }
    void window.agenticxDesktop?.shellOpenPath?.(path);
  };

  const revealInFolder = async (path: string) => {
    const reveal = window.agenticxDesktop?.shellShowItemInFolder;
    if (!reveal) {
      openPath(path);
      return;
    }
    const result = await reveal(path);
    if (!result.ok) console.warn("[SessionArtifactList] reveal failed:", result.error);
  };

  if (paths.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {paths.map((path) => {
        const inAppPreview =
          isInAppHtmlPreviewPath(path) || isInAppArtifactPreviewPath(path);
        return (
          <div
            key={path}
            ref={(node) => {
              rowRefs.current[path] = node;
            }}
            className="overflow-hidden rounded-lg border border-border bg-surface-card transition"
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.5} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[12px] text-text-strong hover:underline"
                title={path}
                onClick={() => openPath(path)}
              >
                {artifactBaseName(path)}
              </button>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => openPath(path)}
                title={inAppPreview ? "在 Near 内预览" : "用系统应用打开"}
              >
                {inAppPreview ? (
                  <Eye className="h-3 w-3" strokeWidth={1.5} />
                ) : (
                  <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                )}
                {inAppPreview ? "预览" : "打开"}
              </button>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void revealInFolder(path)}
                title="在文件管理器中显示"
              >
                <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                定位
              </button>
            </div>
            <div className="truncate px-2.5 pb-2 font-mono text-[10.5px] text-text-faint" title={path}>
              {path}
            </div>
          </div>
        );
      })}
    </div>
  );
}
