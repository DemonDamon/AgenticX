/**
 * Session-level write/edit list for WorkPanel「变更」.
 *
 * Author: Damon Li
 */

import { artifactGlyph, FileTypeMark } from "../messages/artifact-glyph";
import { artifactBaseName } from "../../utils/session-artifacts";
import type { ArtifactChangeRow } from "../../utils/session-artifacts";

type Props = {
  rows: ArtifactChangeRow[];
  onOpenPath?: (path: string) => void;
};

export function SessionChangeList({ rows, onOpenPath }: Props) {
  if (rows.length === 0) return null;
  const added = rows.reduce((sum, row) => sum + row.added, 0);
  const removed = rows.reduce((sum, row) => sum + row.removed, 0);

  return (
    <div className="space-y-1">
      <div className="px-0.5 pb-1.5 text-[12px] text-text-muted">
        文件变更{" "}
        <span className="text-emerald-500">+{added}</span>{" "}
        <span className="text-rose-400">-{removed}</span>
      </div>
      {rows.map((row) => {
        const { kind } = artifactGlyph(row.path);
        return (
          <button
            key={row.path}
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-surface-hover/60"
            title={row.path}
            onClick={() => onOpenPath?.(row.path)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <FileTypeMark kind={kind} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-strong">
              {artifactBaseName(row.path)}
            </span>
            <span className="shrink-0 font-mono text-[11px]">
              {row.added > 0 ? <span className="text-emerald-500">+{row.added}</span> : null}
              {row.added > 0 && row.removed > 0 ? " " : null}
              {row.removed > 0 ? <span className="text-rose-400">-{row.removed}</span> : null}
              {row.added === 0 && row.removed === 0 ? (
                <span className="text-text-faint">·</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
