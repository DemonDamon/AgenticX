import { i18n } from "../../i18n/i18n";
import { absoluteTaskspacePath } from "../../utils/workspace-file-path";
import { officePreviewMime } from "./office-preview-kind";
import { isWorkspaceVideoPath, workspaceVideoMime } from "./video-preview-kind";

export type WorkspacePreviewKind =
  | "text"
  | "markdown"
  | "code"
  | "image"
  | "pdf"
  | "office"
  | "video"
  | "binary";

export type WorkspaceTextRangeQuote = {
  kind: "text-range";
  path: string;
  absolutePath: string;
  startLine?: number;
  endLine?: number;
  snippet: string;
  label: string;
};

export type WorkspaceSpreadsheetQuote = {
  kind: "spreadsheet-range";
  path: string;
  absolutePath: string;
  sheet: string;
  a1: string;
  snippet: string;
  label: string;
};

/** HTML preview select-element → composer chip + context_files (Trae Work). */
export type WorkspaceHtmlElementQuote = {
  kind: "html-element";
  path: string;
  absolutePath: string;
  tagName: string;
  selectorHint: string;
  outerHTML: string;
  innerText?: string;
  label: string;
  /** add = chip only; comment = chip includes user comment (就地评论框提交). */
  intent?: "add" | "comment";
  /** From Trae「评论到对话」inline composer. */
  comment?: string;
};

export type WorkspacePreviewQuotePayload =
  | WorkspaceTextRangeQuote
  | WorkspaceSpreadsheetQuote
  | WorkspaceHtmlElementQuote;

export type WorkspacePreviewLineRange = {
  start: number;
  end: number;
};

/** Open workspace preview from chat (@file chip / path click). */
export type WorkspacePreviewOpenRequest = {
  absolutePath: string;
  lineRange?: WorkspacePreviewLineRange;
};

export type { FileReferenceOpenRequest } from "../../utils/reference-attachment";

export type WorkspacePreview =
  | {
      kind: "text" | "markdown" | "code";
      path: string;
      absolutePath: string;
      content: string;
      size: number;
      truncated: boolean;
      mimeType: string;
      /** Optional mtime from preview loader — used for stale-write guard on save. */
      mtimeMs?: number;
    }
  | {
      kind: "image";
      path: string;
      absolutePath: string;
      size: number;
      mimeType: string;
    }
  | {
      kind: "pdf" | "office" | "binary";
      path: string;
      absolutePath: string;
      size: number;
      mimeType: string;
      message: string;
    }
  | {
      kind: "video";
      path: string;
      absolutePath: string;
      size: number;
      mimeType: string;
    };

export type TaskspaceFilePreviewApi = {
  ok: boolean;
  name?: string;
  path?: string;
  absolute_path?: string;
  content?: string;
  truncated?: boolean;
  size?: number;
  mime_type?: string;
  preview_kind?: WorkspacePreviewKind;
  is_binary?: boolean;
  preview_supported?: boolean;
  /** Optional; when absent, save falls back to no expectedMtimeMs guard. */
  mtimeMs?: number;
  error?: string;
};

export function formatPreviewBytes(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function previewBaseName(path: string): string {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function mapTaskspaceFileToWorkspacePreview(
  result: TaskspaceFilePreviewApi,
  relPath: string,
  taskspaceRoot?: string
): WorkspacePreview | null {
  if (!result.ok) return null;
  const path = String(result.path ?? relPath);
  const absolutePath = String(
    result.absolute_path ??
      (taskspaceRoot ? absoluteTaskspacePath(taskspaceRoot, path) : relPath)
  );
  const size = Number(result.size ?? 0);
  const mimeType = String(result.mime_type ?? "application/octet-stream");
  const previewKind = (result.preview_kind ?? "code") as WorkspacePreviewKind;

  if (previewKind === "image") {
    return { kind: "image", path, absolutePath, size, mimeType };
  }
  if (previewKind === "pdf") {
    return {
      kind: "pdf",
      path,
      absolutePath,
      size,
      mimeType,
      message: i18n.t("preview.pdfOpenInManager", { ns: "workspace" }),
    };
  }
  if (previewKind === "office") {
    return {
      kind: "office",
      path,
      absolutePath,
      size,
      mimeType,
      message: i18n.t("preview.officeOpenInManager", { ns: "workspace" }),
    };
  }
  if (previewKind === "video" || isWorkspaceVideoPath(path) || isWorkspaceVideoPath(absolutePath)) {
    return {
      kind: "video",
      path,
      absolutePath,
      size,
      mimeType: mimeType.startsWith("video/") ? mimeType : workspaceVideoMime(path || absolutePath),
    };
  }
  if (previewKind === "binary") {
    return {
      kind: "binary",
      path,
      absolutePath,
      size,
      mimeType,
      message: i18n.t("preview.typeUnsupported", { ns: "workspace" }),
    };
  }

  const content = result.content ?? "";
  const truncated = !!result.truncated;
  const mtimeMs = typeof result.mtimeMs === "number" ? result.mtimeMs : undefined;
  if (previewKind === "markdown") {
    return { kind: "markdown", path, absolutePath, content, size, truncated, mimeType, mtimeMs };
  }
  if (previewKind === "text") {
    return { kind: "text", path, absolutePath, content, size, truncated, mimeType, mtimeMs };
  }
  return { kind: "code", path, absolutePath, content, size, truncated, mimeType, mtimeMs };
}

export function mapSystemSearchPreviewToWorkspacePreview(
  absolutePath: string,
  result: {
    ok: boolean;
    kind: "text" | "image" | "metadata";
    content?: string;
    fileUrl?: string;
    truncated?: boolean;
    mtimeMs?: number;
    error?: string;
  }
): WorkspacePreview | null {
  if (!result.ok) return null;
  const path = previewBaseName(absolutePath);
  const lower = path.toLowerCase();
  const mimeType =
    lower.endsWith(".md") || lower.endsWith(".mmd") || lower.endsWith(".markdown") || lower.endsWith(".mdx")
      ? "text/markdown"
    : lower.endsWith(".json") ? "application/json"
    : lower.endsWith(".yaml") || lower.endsWith(".yml") ? "text/yaml"
    : lower.endsWith(".svg") ? "image/svg+xml"
    : "text/plain";

  if (result.kind === "image" && result.fileUrl) {
    return {
      kind: "image",
      path,
      absolutePath,
      size: 0,
      mimeType: lower.endsWith(".svg") ? "image/svg+xml" : "image/png",
    };
  }

  if (result.kind === "text" && typeof result.content === "string") {
    const content = result.content;
    const size = content.length;
    const truncated = !!result.truncated;
    const mtimeMs = typeof result.mtimeMs === "number" ? result.mtimeMs : undefined;
    if (
      lower.endsWith(".md") ||
      lower.endsWith(".mmd") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".mdx")
    ) {
      return { kind: "markdown", path, absolutePath, content, size, truncated, mimeType, mtimeMs };
    }
    if (lower.endsWith(".txt") || lower.endsWith(".log")) {
      return {
        kind: "text",
        path,
        absolutePath,
        content,
        size,
        truncated,
        mimeType: "text/plain",
        mtimeMs,
      };
    }
    return { kind: "code", path, absolutePath, content, size, truncated, mimeType, mtimeMs };
  }

  return {
    kind: "binary",
    path,
    absolutePath,
    size: 0,
    mimeType: "application/octet-stream",
    message: result.content || result.error || i18n.t("preview.typeUnsupportedShort", { ns: "workspace" }),
  };
}

export function previewCopyText(preview: WorkspacePreview): string {
  if (preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code") {
    return preview.content;
  }
  return preview.absolutePath;
}

/** Classify a local absolute path for Trae-style in-panel preview (no Workspace tab). */
export async function loadAbsoluteFilePreview(
  absolutePathRaw: string,
): Promise<{ ok: true; preview: WorkspacePreview } | { ok: false; error: string }> {
  const absolutePath = String(absolutePathRaw || "").trim();
  if (!absolutePath) return { ok: false, error: "empty path" };

  const desktop = window.agenticxDesktop;
  if (!desktop?.systemSearchPreview) {
    return { ok: false, error: i18n.t("preview.clientNoPreview", { ns: "workspace" }) };
  }

  const base = previewBaseName(absolutePath);
  const lower = base.toLowerCase();

  try {
    const direct = await desktop.systemSearchPreview(absolutePath);
    if (direct.ok) {
      const mapped = mapSystemSearchPreviewToWorkspacePreview(absolutePath, direct);
      if (
        mapped &&
        (mapped.kind === "text" ||
          mapped.kind === "markdown" ||
          mapped.kind === "code" ||
          mapped.kind === "image")
      ) {
        return { ok: true, preview: mapped };
      }
    }

    if (lower.endsWith(".pdf")) {
      return {
        ok: true,
        preview: {
          kind: "pdf",
          path: base,
          absolutePath,
          size: 0,
          mimeType: "application/pdf",
          message: i18n.t("preview.pdfOpenInManager", { ns: "workspace" }),
        },
      };
    }
    if (isWorkspaceVideoPath(lower)) {
      return {
        ok: true,
        preview: {
          kind: "video",
          path: base,
          absolutePath,
          size: 0,
          mimeType: workspaceVideoMime(lower),
        },
      };
    }
    if (
      lower.endsWith(".doc") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".xls") ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".ppt") ||
      lower.endsWith(".pptx")
    ) {
      return {
        ok: true,
        preview: {
          kind: "office",
          path: base,
          absolutePath,
          size: 0,
          mimeType: officePreviewMime(lower),
          message: i18n.t("preview.officeOpenInManager", { ns: "workspace" }),
        },
      };
    }

    if (direct.ok) {
      const mapped = mapSystemSearchPreviewToWorkspacePreview(absolutePath, direct);
      if (mapped) return { ok: true, preview: mapped };
    }
    return { ok: false, error: direct.error || i18n.t("preview.cannotPreview", { ns: "workspace" }) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
