import { absoluteTaskspacePath } from "../../utils/workspace-file-path";

export type WorkspacePreviewKind =
  | "text"
  | "markdown"
  | "code"
  | "image"
  | "pdf"
  | "office"
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

export type WorkspacePreviewQuotePayload = WorkspaceTextRangeQuote | WorkspaceSpreadsheetQuote;

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
      message: "PDF 预览加载失败时，可在文件管理器中打开。",
    };
  }
  if (previewKind === "office") {
    return {
      kind: "office",
      path,
      absolutePath,
      size,
      mimeType,
      message: "Office 预览加载失败时，可在文件管理器中打开。",
    };
  }
  if (previewKind === "binary") {
    return {
      kind: "binary",
      path,
      absolutePath,
      size,
      mimeType,
      message: "该文件类型暂不支持预览。",
    };
  }

  const content = result.content ?? "";
  const truncated = !!result.truncated;
  if (previewKind === "markdown") {
    return { kind: "markdown", path, absolutePath, content, size, truncated, mimeType };
  }
  if (previewKind === "text") {
    return { kind: "text", path, absolutePath, content, size, truncated, mimeType };
  }
  return { kind: "code", path, absolutePath, content, size, truncated, mimeType };
}

export function mapSystemSearchPreviewToWorkspacePreview(
  absolutePath: string,
  result: {
    ok: boolean;
    kind: "text" | "image" | "metadata";
    content?: string;
    fileUrl?: string;
    truncated?: boolean;
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
    if (
      lower.endsWith(".md") ||
      lower.endsWith(".mmd") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".mdx")
    ) {
      return { kind: "markdown", path, absolutePath, content, size, truncated, mimeType };
    }
    if (lower.endsWith(".txt") || lower.endsWith(".log")) {
      return { kind: "text", path, absolutePath, content, size, truncated, mimeType: "text/plain" };
    }
    return { kind: "code", path, absolutePath, content, size, truncated, mimeType };
  }

  return {
    kind: "binary",
    path,
    absolutePath,
    size: 0,
    mimeType: "application/octet-stream",
    message: result.content || result.error || "该文件类型暂不支持预览",
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
    return { ok: false, error: "当前客户端不支持文件预览" };
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
          message: "PDF 预览加载失败时，可在文件管理器中打开。",
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
          mimeType: "application/octet-stream",
          message: "Office 预览加载失败时，可在文件管理器中打开。",
        },
      };
    }

    if (direct.ok) {
      const mapped = mapSystemSearchPreviewToWorkspacePreview(absolutePath, direct);
      if (mapped) return { ok: true, preview: mapped };
    }
    return { ok: false, error: direct.error || "无法预览该文件" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
