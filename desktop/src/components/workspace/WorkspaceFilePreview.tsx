import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, FileText, FolderOpen, ImageIcon, X } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";
import ReactMarkdown from "react-markdown";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  normalizeChatMarkdownContent,
} from "../messages/markdown-components";
import {
  formatPreviewBytes,
  previewBaseName,
  type WorkspacePreview,
} from "./workspace-preview-types";
import { DocxPreview } from "./DocxPreview";
import { PdfPreview } from "./PdfPreview";
import { PreviewFallback } from "./PreviewFallback";
import { SpreadsheetPreview } from "./SpreadsheetPreview";

export type WorkspaceFilePreviewProps = {
  preview: WorkspacePreview;
  anchor: { top: number; bottom: number; left: number };
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "bash";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".log") || lower.endsWith(".txt")) return "plain";
  return "clike";
}

function previewKindLabel(kind: WorkspacePreview["kind"]): string {
  switch (kind) {
    case "markdown":
      return "Markdown";
    case "code":
      return "Code";
    case "text":
      return "Text";
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "office":
      return "Office";
    case "binary":
      return "Binary";
    default: {
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}

function officePreviewVariant(path: string): "docx" | "xlsx" | "other" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  return "other";
}

function BinaryPlaceholderBody({
  preview,
  onCopy,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: {
  preview: Extract<WorkspacePreview, { kind: "pdf" | "office" | "binary" }>;
  onCopy: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
}) {
  return (
    <PreviewFallback
      title={previewKindLabel(preview.kind)}
      message={preview.message}
      mimeType={preview.mimeType}
      onCopyPath={onCopy}
      onRevealInFileManager={onRevealInFileManager}
      revealInFileManagerLabel={revealInFileManagerLabel}
      absolutePath={preview.absolutePath}
    />
  );
}

function OfficePreviewBody({
  preview,
  onCopy,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: {
  preview: Extract<WorkspacePreview, { kind: "office" }>;
  onCopy: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
}) {
  const variant = officePreviewVariant(preview.path);
  if (variant === "docx") {
    return (
      <DocxPreview
        absolutePath={preview.absolutePath}
        mimeType={preview.mimeType}
        onCopyPath={onCopy}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
      />
    );
  }
  if (variant === "xlsx") {
    return (
      <SpreadsheetPreview
        absolutePath={preview.absolutePath}
        mimeType={preview.mimeType}
        onCopyPath={onCopy}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
      />
    );
  }
  return (
    <BinaryPlaceholderBody
      preview={preview}
      onCopy={onCopy}
      onRevealInFileManager={onRevealInFileManager}
      revealInFileManagerLabel={revealInFileManagerLabel}
    />
  );
}

function ImagePreviewBody({
  absolutePath,
  onCopy,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: {
  absolutePath: string;
  onCopy: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataUrl(null);
    const api = window.agenticxDesktop?.loadLocalImageDataUrl;
    if (typeof api !== "function") {
      setLoading(false);
      setError("当前客户端不支持本地图片预览");
      return () => {
        cancelled = true;
      };
    }
    void api(absolutePath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.dataUrl) {
          setError(res.error ?? "图片加载失败");
          setDataUrl(null);
        } else {
          setDataUrl(res.dataUrl);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setDataUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center bg-surface-base p-6">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <ImageIcon className="h-4 w-4 animate-pulse" strokeWidth={1.5} />
          正在加载图片…
        </div>
      </div>
    );
  }

  if (error || !dataUrl) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-4 bg-surface-base px-8 py-10 text-center">
        <p className="text-sm text-rose-300">{error ?? "图片加载失败"}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
            onClick={onCopy}
          >
            复制路径
          </button>
          {onRevealInFileManager ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-surface-popover px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
              onClick={() => onRevealInFileManager(absolutePath)}
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
              {revealInFileManagerLabel ?? "在文件管理器中显示"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-surface-base p-6">
      <img src={dataUrl} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>
  );
}

function TextualPreviewBody({ preview }: { preview: Extract<WorkspacePreview, { kind: "text" | "markdown" | "code" }> }) {
  const highlightedCode = useMemo(() => {
    if (preview.kind === "markdown") return "";
    const language = detectLanguage(preview.path);
    const grammar = Prism.languages[language] ?? Prism.languages.clike;
    return Prism.highlight(preview.content, grammar, language);
  }, [preview]);

  const markdownContent = useMemo(
    () => (preview.kind === "markdown" ? normalizeChatMarkdownContent(preview.content) : ""),
    [preview]
  );

  if (preview.kind === "markdown") {
    return (
      <div className="msg-content px-6 py-5 text-[13px] leading-relaxed text-text-primary">
        <ReactMarkdown
          remarkPlugins={chatRemarkPlugins}
          rehypePlugins={chatRehypePlugins}
          components={chatMarkdownComponents}
          urlTransform={chatUrlTransform}
        >
          {markdownContent}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="m-0 min-h-0 border-none bg-transparent px-6 py-5 text-[13px] leading-[1.65]">
      <code
        className={`language-${detectLanguage(preview.path)}`}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    </pre>
  );
}

export function WorkspaceFilePreview({
  preview,
  anchor,
  copied,
  onCopy,
  onClose,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: WorkspaceFilePreviewProps) {
  const truncated =
    preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code"
      ? preview.truncated
      : false;

  return createPortal(
    <>
      <div
        className="fixed z-[55]"
        style={{
          top: 0,
          bottom: 0,
          left: 0,
          right: Math.max(0, window.innerWidth - anchor.left),
        }}
        onMouseDown={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`预览 ${previewBaseName(preview.path)}`}
        className="animate-preview-pop fixed z-[56] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-surface-popover shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]"
        style={{
          top: anchor.top + 8,
          bottom: Math.max(8, window.innerHeight - anchor.bottom + 8),
          right: Math.max(8, window.innerWidth - anchor.left + 8),
          width: Math.min(760, Math.max(420, anchor.left - 24)),
          transformOrigin: "right center",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-popover px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-surface-base shadow-sm">
            <FileText className="h-4 w-4 text-text-muted" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[14px] font-semibold tracking-tight text-text-strong"
              title={preview.path}
            >
              {previewBaseName(preview.path)}
            </div>
            <div
              className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-mono text-text-faint"
              title={preview.path}
            >
              <span className="truncate">{preview.path}</span>
              <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-text-faint opacity-50" />
              <span className="shrink-0">{formatPreviewBytes(preview.size)}</span>
            </div>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
              onClick={onCopy}
              title={
                preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code"
                  ? "复制文件内容"
                  : "复制路径"
              }
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" strokeWidth={2} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
            <div className="h-4 w-px bg-border opacity-50" />
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
              onClick={onClose}
              title="关闭预览（Esc）"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="preview-scrollbar min-h-0 flex-1 overflow-auto bg-surface-base">
          {preview.kind === "image" ? (
            <ImagePreviewBody
              absolutePath={preview.absolutePath}
              onCopy={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : preview.kind === "pdf" ? (
            <PdfPreview
              absolutePath={preview.absolutePath}
              mimeType={preview.mimeType}
              onCopyPath={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : preview.kind === "office" ? (
            <OfficePreviewBody
              preview={preview}
              onCopy={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : preview.kind === "binary" ? (
            <BinaryPlaceholderBody
              preview={preview}
              onCopy={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : (
            <TextualPreviewBody preview={preview} />
          )}
        </div>
        {truncated ? (
          <div className="shrink-0 border-t border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-500/90">
            文件过大，已截断显示（{formatPreviewBytes(preview.size)}）。
          </div>
        ) : null}
      </div>
    </>,
    document.body
  );
}
