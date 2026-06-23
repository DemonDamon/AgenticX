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
  relPath: string
): WorkspacePreview | null {
  if (!result.ok) return null;
  const path = String(result.path ?? relPath);
  const absolutePath = String(result.absolute_path ?? relPath);
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
      message: "PDF 预览将在下一阶段支持；当前可在系统应用中打开。",
    };
  }
  if (previewKind === "office") {
    return {
      kind: "office",
      path,
      absolutePath,
      size,
      mimeType,
      message: "Office 文档预览将在下一阶段支持；当前可在系统应用中打开。",
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

export function previewCopyText(preview: WorkspacePreview): string {
  if (preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code") {
    return preview.content;
  }
  return preview.absolutePath;
}
