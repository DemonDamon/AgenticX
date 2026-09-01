/**
 * Filled deliverable cards under the assistant reply.
 * Download, copy-path and reveal live inside the tile so nothing overlays
 * the message below.
 *
 * Author: Damon Li
 */

import { useEffect, useState, type ReactNode } from "react";
import { Check, CloudDownload, Copy, FolderOpen } from "lucide-react";
import { HoverTip } from "../ds/HoverTip";
import { artifactGlyph, FileTypeMark } from "./artifact-glyph";
import {
  artifactBaseName,
  artifactExt,
  orderTurnArtifactsForCard,
} from "../../utils/session-artifacts";
import { formatPreviewBytes } from "../workspace/workspace-preview-types";

/** Cards shown before the grid collapses behind a single expander. */
const GRID_LIMIT = 4;

type Props = {
  paths: string[];
  onOpenPath?: (path: string) => void;
};

function TileAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTip label={label} tooltipAlign="end">
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-text-strong focus-visible:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] active:scale-[0.94]"
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
    </HoverTip>
  );
}

export function TurnArtifactCard({ paths, onOpenPath }: Props) {
  const ordered = orderTurnArtifactsForCard(paths);
  const [expanded, setExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [sizeByPath, setSizeByPath] = useState<Record<string, number>>({});
  const extraCount = Math.max(0, ordered.length - GRID_LIMIT);
  const visible = extraCount === 0 || expanded ? ordered : ordered.slice(0, GRID_LIMIT);

  useEffect(() => {
    const stat = window.agenticxDesktop?.statLocalPath;
    if (!stat) return;
    let cancelled = false;
    void Promise.all(
      ordered.map(async (path) => {
        try {
          const result = await stat(path);
          if (result.ok && !result.isDirectory && typeof result.size === "number") {
            return [path, result.size] as const;
          }
        } catch {
          /* Metadata is optional. */
        }
        return null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSizeByPath(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry != null)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [ordered.join("\0")]);

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
    <div className="w-full min-w-0">
      <div
        className={`grid gap-2 ${
          ordered.length > 1 ? "sm:grid-cols-2" : "w-fit max-w-full grid-cols-1"
        }`}
      >
        {visible.map((path) => {
          const name = artifactBaseName(path);
          const size = sizeByPath[path] != null ? formatPreviewBytes(sizeByPath[path]) : "";
          const meta = size || artifactExt(path).toUpperCase();
          const { kind, tint, fg } = artifactGlyph(path);
          const copied = copiedPath === path;
          return (
            <div
              key={path}
              className="flex min-w-0 items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] py-2 pl-2.5 pr-1.5 transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_srgb,var(--text-primary)_14%,transparent)]"
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-2.5 text-left outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-1 focus-visible:ring-border active:scale-[0.99]"
                title={path}
                onClick={() => (onOpenPath ? onOpenPath(path) : undefined)}
                aria-label={`预览 ${name}`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: tint, color: fg }}
                >
                  <FileTypeMark kind={kind} />
                </span>
                <span className="flex min-w-0 flex-col gap-1 pr-2">
                  <span className="min-w-0 truncate text-[13px] font-medium leading-none text-text-strong">
                    {name}
                  </span>
                  <span className="min-w-0 truncate text-[11.5px] leading-none text-text-faint">
                    {meta}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center">
                <TileAction label={`另存为 ${name}`} onClick={() => void saveAs(path)}>
                  <CloudDownload className="h-[16px] w-[16px]" strokeWidth={1.5} />
                </TileAction>
                <TileAction
                  label={copied ? "已复制路径" : `复制路径 ${name}`}
                  onClick={() => void copyPath(path)}
                >
                  {copied ? (
                    <Check className="h-[16px] w-[16px] text-emerald-400" strokeWidth={2} />
                  ) : (
                    <Copy className="h-[16px] w-[16px]" strokeWidth={1.5} />
                  )}
                </TileAction>
                <TileAction label={`在访达中显示 ${name}`} onClick={() => void revealInFolder(path)}>
                  <FolderOpen className="h-[16px] w-[16px]" strokeWidth={1.5} />
                </TileAction>
              </div>
            </div>
          );
        })}
      </div>
      {extraCount > 0 ? (
        <button
          type="button"
          className="mt-1.5 rounded-md px-0.5 py-0.5 text-left text-[11.5px] text-text-muted transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-text-primary active:scale-[0.98]"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "收起产物" : `查看全部 ${ordered.length} 个产物`}
        </button>
      ) : null}
    </div>
  );
}
