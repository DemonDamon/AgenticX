/**
 * Persist fetched page full-text as deep-research artifacts (separate quota from memos/reports).
 */

import { createHash } from "node:crypto";
import type { ArtifactStore } from "./artifact-store";
import { normalizeCitationUrl } from "./registry";

export const MAX_ARCHIVED_PAGES_PER_RUN = 60;
/** 单篇落盘上限，低于 artifact-store 的 512KB 硬顶。 */
export const MAX_ARCHIVE_CHARS = 20_000;

/** URL → 稳定短 id，用作落盘文件名。 */
export function pageArchiveKey(url: string): string {
  const normalized = normalizeCitationUrl(url);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function pageArchivePath(runId: string, url: string): string {
  return `research/${runId}/pages/${pageArchiveKey(url)}.md`;
}

function escapeFrontMatterValue(raw: string): string {
  return raw.replace(/\r?\n/g, " ").trim();
}

/** 写入一篇正文；超配额或写失败都静默跳过，绝不影响主流程。 */
export async function archivePage(input: {
  artifactStore: ArtifactStore;
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  url: string;
  title: string;
  backend: string;
  text: string;
  archivedSoFar: number;
}): Promise<boolean> {
  if (input.archivedSoFar >= MAX_ARCHIVED_PAGES_PER_RUN) return false;

  const body =
    input.text.length > MAX_ARCHIVE_CHARS
      ? `${input.text.slice(0, MAX_ARCHIVE_CHARS).trimEnd()}…`
      : input.text;
  const content = [
    "---",
    `url: ${escapeFrontMatterValue(input.url)}`,
    `title: ${escapeFrontMatterValue(input.title)}`,
    `backend: ${escapeFrontMatterValue(input.backend)}`,
    `chars: ${body.length}`,
    "---",
    "",
    body,
    "",
  ].join("\n");

  try {
    await input.artifactStore.write({
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId: input.sessionId,
      runId: input.runId,
      path: pageArchivePath(input.runId, input.url),
      title: input.title || input.url,
      kind: "other",
      mimeType: "text/markdown",
      content,
    });
    return true;
  } catch (error) {
    console.warn(
      "[page-archive]",
      input.url,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
