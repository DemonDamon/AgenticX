import { isAbsoluteFilePath } from "./workspace-file-path";

const OUTPUT_FILES_MARKER = "产出文件:";

/** Parse structured「产出文件」footer from backend summary (numbered or comma-separated). */
export function extractOutputFilesFromSummary(summary?: string): string[] {
  if (!summary) return [];
  const idx = summary.lastIndexOf(OUTPUT_FILES_MARKER);
  if (idx < 0) return [];
  const raw = summary.slice(idx + OUTPUT_FILES_MARKER.length).trim();
  if (!raw || raw === "(无)") return [];

  const numbered = [...raw.matchAll(/^\s*\d+\.\s+(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length > 0);
  if (numbered.length > 0) return numbered;

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Pull absolute local paths embedded in agent prose (e.g. markdown code spans). */
export function extractAbsolutePathsFromText(text?: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/\.\.\.\(truncated\)/g, "");
  const matches =
    cleaned.match(
      /(?:\/(?:Users|home|tmp|var|opt|private|Volumes)[^\s`'"()（）,\]<>]+|~\/[^\s`'"()（）,\]<>]+|[a-zA-Z]:[\\/][^\s`'"()（）,\]<>]+)/g,
    ) ?? [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const path = raw.replace(/^[`'"]+|[`'"]+$/g, "").trim();
    if (!path || !isAbsoluteFilePath(path) || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function mergeSubAgentOutputPaths(...groups: Array<string[] | undefined>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    for (const raw of group) {
      const path = String(raw ?? "").trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}

export function resolveSubAgentOutputPaths(
  summary?: string,
  extra?: { resultFile?: string; outputFiles?: string[] },
): string[] {
  return mergeSubAgentOutputPaths(
    extra?.outputFiles,
    extra?.resultFile ? [extra.resultFile] : undefined,
    extractOutputFilesFromSummary(summary),
  );
}
