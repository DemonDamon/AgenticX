/**
 * Persist fetched page full-text as deep-research artifacts (separate quota from memos/reports).
 */

import { createHash } from "node:crypto";
import type { ArtifactStore } from "./artifact-store";
import { normalizeCitationUrl } from "./registry";

export const MAX_ARCHIVED_PAGES_PER_RUN = 60;
/** 单篇落盘上限，低于 artifact-store 的 512KB 硬顶。 */
export const MAX_ARCHIVE_CHARS = 20_000;

/** URL → 稳定短 id，保证同 URL 不重复落盘。 */
export function pageArchiveKey(url: string): string {
  const normalized = normalizeCitationUrl(url);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

const SLUG_MAX = 40;

/** 把标题压成可读文件名前缀（保留中英文数字）；空则回落 host/path。 */
export function pageArchiveSlug(title: string, url: string): string {
  const fromTitle = title
    .normalize("NFKC")
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/g, "");
  if (fromTitle) return fromTitle;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const seg =
      u.pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.[a-z0-9]{1,8}$/i, "") ?? "";
    const raw = seg ? `${host}-${seg}` : host;
    return raw
      .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, SLUG_MAX) || "page";
  } catch {
    return "page";
  }
}

/** 可读名 + 短 hash，例如 `DeepSeek-V4技术解读_a1b2c3d4e5f60789.md`。 */
export function pageArchiveFileName(title: string, url: string): string {
  return `${pageArchiveSlug(title, url)}_${pageArchiveKey(url)}.md`;
}

export function pageArchivePath(runId: string, url: string, title = ""): string {
  return `research/${runId}/pages/${pageArchiveFileName(title, url)}`;
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
      path: pageArchivePath(input.runId, input.url, input.title),
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
