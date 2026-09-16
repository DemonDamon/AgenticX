/**
 * Gate session write/edit decorations so only「变更」preview shows them.
 *
 * Author: Damon Li
 */

import type { FileChangeHighlight } from "./session-change-highlights";

export type PreviewHighlightMode = "plain" | "changes";

export function nextPreviewHighlightMode(
  incoming?: string | null,
): PreviewHighlightMode {
  return incoming === "changes" ? "changes" : "plain";
}

export function resolveActiveChangeHighlight(
  mode: PreviewHighlightMode | undefined,
  collected: FileChangeHighlight | null,
): FileChangeHighlight | null {
  if (mode !== "changes") return null;
  return collected;
}
