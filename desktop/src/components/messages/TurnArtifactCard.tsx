/**
 * Compact deliverable card under the final assistant reply of a turn.
 *
 * Author: Damon Li
 */

import { useState } from "react";
import { Check, Copy, Download, Eye, FileText, FolderOpen } from "lucide-react";
import {
  artifactBaseName,
  orderTurnArtifactsForCard,
} from "../../utils/session-artifacts";

type Props = {
  paths: string[];
  onOpenPath?: (path: string) => void;
};

export function TurnArtifactCard({ paths, onOpenPath }: Props) {
  const ordered = orderTurnArtifactsForCard(paths);
  const [expanded, setExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const extraCount = Math.max(0, ordered.length - 1);
  const visible = extraCount === 0 || expanded ? ordered : ordered.slice(0, 1);

  if (ordered.length === 0) return null;

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath(null), 1600);
    } catch {
      /* ignore */
    }
  };

  const revealInFolder = async (path: string) => {
    const reveal = window.agenticxDesktop?.shellShowItemInFolder;
    if (!reveal) return;
    const result = await reveal(path);
    if (!result.ok) console.warn("[TurnArtifactCard] reveal failed:", result.error);
  };

  const saveAs = async (path: string) => {
    const api = window.agenticxDesktop?.copyLocalFileAs;
    if (typeof api !== "function") return;
    try {
      const result = await api({ sourcePath: path });
      if (!result.ok && result.error) {
        console.warn("[TurnArtifactCard] save-as failed:", result.error);
      }
    } catch (err) {
      console.warn("[TurnArtifactCard] save-as failed:", err);
    }
  };

  return (
    <div className="mt-1 w-full min-w-0 px-4">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-card">
        <div className="px-2.5 pt-2 text-[11px] font-medium tracking-wide text-text-muted">
          本轮产物
        </div>
        <div className="space-y-1 p-2">
          {visible.map((path, index) => (
            <div key={path} className="flex flex-wrap items-center gap-2 rounded-md px-0.5 py-1">
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.5} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[12px] text-text-strong hover:underline"
                title={path}
                onClick={() => (onOpenPath ? onOpenPath(path) : undefined)}
              >
                {index === 0 && extraCount > 0 ? (
                  <span className="mr-1 text-[10px] text-text-faint">主</span>
                ) : null}
                {artifactBaseName(path)}
              </button>
              {onOpenPath ? (
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                  onClick={() => onOpenPath(path)}
                  title="在应用内预览"
                >
                  <Eye className="h-3 w-3" strokeWidth={1.5} />
                  预览
                </button>
              ) : null}
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void revealInFolder(path)}
                title="在文件管理器中显示"
              >
                <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                访达
              </button>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void copyPath(path)}
                title="复制路径"
              >
                {copiedPath === path ? (
                  <Check className="h-3 w-3 text-emerald-400" strokeWidth={2} />
                ) : (
                  <Copy className="h-3 w-3" strokeWidth={1.5} />
                )}
                复制路径
              </button>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void saveAs(path)}
                title="另存为"
              >
                <Download className="h-3 w-3" strokeWidth={1.5} />
                另存为
              </button>
            </div>
          ))}
          {extraCount > 0 ? (
            <button
              type="button"
              className="w-full rounded-md px-1.5 py-1 text-left text-[12px] text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? "收起" : `其他 ${extraCount} 个`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
