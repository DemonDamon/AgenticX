import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Eye, FileText, FolderOpen, ImageIcon, Pencil, X } from "lucide-react";
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
  MarkdownContext,
  normalizeChatMarkdownContent,
} from "../messages/markdown-components";
import {
  formatPreviewBytes,
  previewBaseName,
  type WorkspacePreviewLineRange,
  type WorkspacePreviewQuotePayload,
  type WorkspacePreview,
} from "./workspace-preview-types";
import { DocxPreview } from "./DocxPreview";
import { PdfPreview } from "./PdfPreview";
import { PreviewFallback } from "./PreviewFallback";
import { SpreadsheetPreview } from "./SpreadsheetPreview";
import {
  computeSelectionPopupAnchor,
  SelectionQuotePopover,
  type SelectionPopupAnchor,
} from "./selection-quote-popover";
import { resolveMarkdownHostPath } from "../../utils/workspace-file-path";

type TextualPreview = {
  kind: "text" | "markdown" | "code";
  path: string;
  absolutePath: string;
  content: string;
  size: number;
  truncated: boolean;
  mimeType: string;
};

type BinaryLikePreview = {
  kind: "pdf" | "office" | "binary";
  path: string;
  absolutePath: string;
  size: number;
  mimeType: string;
  message: string;
};

type OfficePreview = BinaryLikePreview & { kind: "office" };

export type WorkspaceFilePreviewProps = {
  preview: WorkspacePreview;
  anchor: { top: number; bottom: number; left: number };
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onQuoteSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
  initialLineRange?: WorkspacePreviewLineRange;
  /** Taskspace root for resolving relative absolutePath / image assets. */
  taskspaceRoot?: string;
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
  preview: BinaryLikePreview;
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
  onQuoteSnippet,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: {
  preview: OfficePreview;
  onCopy: () => void;
  onQuoteSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
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
        path={preview.path}
        absolutePath={preview.absolutePath}
        mimeType={preview.mimeType}
        onCopyPath={onCopy}
        onQuoteSelection={onQuoteSnippet}
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

function LineFocusedSourceView({
  content,
  lineRange,
}: {
  content: string;
  lineRange: WorkspacePreviewLineRange;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => content.split("\n"), [content]);
  const start = Math.max(1, Math.floor(lineRange.start));
  const end = Math.max(start, Math.floor(lineRange.end));

  useEffect(() => {
    let cancelled = false;
    const scrollToLine = (): boolean => {
      const scrollEl = containerRef.current?.closest(".preview-scrollbar") as HTMLElement | null;
      const lineEl = containerRef.current?.querySelector(`[data-preview-line="${start}"]`);
      if (!scrollEl || !lineEl) return false;
      const scrollRect = scrollEl.getBoundingClientRect();
      const lineRect = lineEl.getBoundingClientRect();
      const delta = lineRect.top - scrollRect.top - scrollEl.clientHeight * 0.35;
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta);
      return true;
    };
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      if (scrollToLine() || attempts >= 10) return;
      attempts += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [content, start]);

  return (
    <div ref={containerRef} className="px-6 py-5 font-mono text-[13px] leading-[1.65] text-text-primary">
      {lines.map((line, index) => {
        const lineNo = index + 1;
        const highlighted = lineNo >= start && lineNo <= end;
        return (
          <div
            key={lineNo}
            data-preview-line={lineNo}
            className={`flex min-w-0 rounded-sm ${
              highlighted ? "bg-yellow-400/30 ring-1 ring-inset ring-yellow-400/50" : ""
            }`}
          >
            <span
              className={`w-11 shrink-0 select-none pr-3 text-right tabular-nums ${
                highlighted ? "font-semibold text-yellow-200" : "text-text-faint"
              }`}
            >
              {lineNo}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

type TextualViewMode = "preview" | "edit";

function TextualPreviewBody({
  preview,
  onQuoteSnippet,
  initialLineRange,
  viewMode,
  editContent,
  onEditContentChange,
  markdownHostPath,
}: {
  preview: TextualPreview;
  onQuoteSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
  initialLineRange?: WorkspacePreviewLineRange;
  viewMode: TextualViewMode;
  editContent: string;
  onEditContentChange: (value: string) => void;
  markdownHostPath: string;
}) {
  if (initialLineRange) {
    return <LineFocusedSourceView content={preview.content} lineRange={initialLineRange} />;
  }

  const highlightedCode = useMemo(() => {
    if (preview.kind === "markdown") return "";
    const language = detectLanguage(preview.path);
    const grammar = Prism.languages[language] ?? Prism.languages.clike;
    return Prism.highlight(preview.content, grammar, language);
  }, [preview]);

  const markdownContent = useMemo(
    () => (preview.kind === "markdown" ? normalizeChatMarkdownContent(editContent) : ""),
    [preview.kind, editContent]
  );
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const codeBlockRef = useRef<HTMLPreElement | null>(null);
  const [selectionRange, setSelectionRange] = useState<{
    startLine?: number;
    endLine?: number;
    snippet: string;
    anchor: SelectionPopupAnchor;
  } | null>(null);

  const toLineNumber = useCallback((content: string, charOffset: number): number => {
    const safeOffset = Math.max(0, Math.min(charOffset, content.length));
    if (safeOffset <= 0) return 1;
    let line = 1;
    for (let i = 0; i < safeOffset; i += 1) {
      if (content[i] === "\n") line += 1;
    }
    return line;
  }, []);

  useEffect(() => {
    setSelectionRange(null);
  }, [preview.path, preview.content, preview.kind]);

  const syncSelectionRange = useCallback(() => {
    const container = preview.kind === "markdown" ? markdownRef.current : codeBlockRef.current;
    if (!container) {
      setSelectionRange(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionRange(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const within =
      container.contains(range.startContainer) && container.contains(range.endContainer);
    if (!within) {
      setSelectionRange(null);
      return;
    }
    const selectedText = sel.toString().replace(/\u00a0/g, " ").trim();
    if (!selectedText) {
      setSelectionRange(null);
      return;
    }
    const anchor = computeSelectionPopupAnchor(range);
    if (!anchor) {
      setSelectionRange(null);
      return;
    }
    const preStart = document.createRange();
    preStart.selectNodeContents(container);
    preStart.setEnd(range.startContainer, range.startOffset);
    const preEnd = document.createRange();
    preEnd.selectNodeContents(container);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const startOffset = preStart.toString().length;
    const endOffset = preEnd.toString().length;
    if (preview.kind === "markdown") {
      const idx = preview.content.indexOf(selectedText);
      if (idx >= 0) {
        const startLine = toLineNumber(preview.content, idx);
        const endLine = Math.max(startLine, toLineNumber(preview.content, idx + selectedText.length));
        setSelectionRange({ startLine, endLine, snippet: selectedText, anchor });
        return;
      }
      setSelectionRange({ snippet: selectedText, anchor });
      return;
    }
    const startLine = toLineNumber(preview.content, startOffset);
    const endLine = Math.max(startLine, toLineNumber(preview.content, endOffset));
    const lines = preview.content.split("\n");
    const snippet = lines.slice(startLine - 1, endLine).join("\n").trimEnd();
    if (!snippet.trim()) {
      setSelectionRange({ snippet: selectedText, anchor });
      return;
    }
    setSelectionRange({ startLine, endLine, snippet, anchor });
  }, [preview.content, preview.kind, toLineNumber]);

  useEffect(() => {
    const onSelectionChange = () => syncSelectionRange();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [syncSelectionRange]);

  useEffect(() => {
    const container = preview.kind === "markdown" ? markdownRef.current : codeBlockRef.current;
    const scrollEl = container?.closest(".preview-scrollbar");
    if (!scrollEl) return;
    const onScroll = () => syncSelectionRange();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [preview.kind, syncSelectionRange]);

  const editLineCount = useMemo(
    () => Math.max(24, editContent.split("\n").length + 2),
    [editContent]
  );

  if (preview.kind === "markdown" && viewMode === "edit") {
    return (
      <textarea
        rows={editLineCount}
        className="m-0 block w-full resize-none border-0 bg-transparent px-6 py-5 font-mono text-[13px] leading-[1.65] text-text-primary outline-none ring-0 focus:outline-none focus:ring-0"
        value={editContent}
        onChange={(e) => onEditContentChange(e.target.value)}
        spellCheck={false}
        aria-label="编辑 Markdown 源码"
      />
    );
  }

  if (preview.kind === "markdown") {
    return (
      <div className="relative">
        {selectionRange && onQuoteSnippet ? (
          <SelectionQuotePopover
            anchor={selectionRange.anchor}
            onQuote={() =>
              onQuoteSnippet({
                kind: "text-range",
                path: preview.path,
                absolutePath: preview.absolutePath,
                startLine: selectionRange.startLine,
                endLine: selectionRange.endLine,
                snippet: selectionRange.snippet,
                label:
                  selectionRange.startLine && selectionRange.endLine
                    ? `${previewBaseName(preview.path)} (${selectionRange.startLine}-${selectionRange.endLine})`
                    : `${previewBaseName(preview.path)} (片段)`,
              })
            }
          />
        ) : null}
        <MarkdownContext.Provider
          value={{
            markdownFilePath: markdownHostPath,
            documentImage: true,
          }}
        >
          <div ref={markdownRef} className="msg-content px-6 py-5 text-[13px] leading-relaxed text-text-primary">
            <ReactMarkdown
              remarkPlugins={chatRemarkPlugins}
              rehypePlugins={chatRehypePlugins}
              components={chatMarkdownComponents}
              urlTransform={chatUrlTransform}
            >
              {markdownContent}
            </ReactMarkdown>
          </div>
        </MarkdownContext.Provider>
      </div>
    );
  }

  return (
    <div className="relative">
      {selectionRange && onQuoteSnippet ? (
        <SelectionQuotePopover
          anchor={selectionRange.anchor}
          onQuote={() =>
            onQuoteSnippet({
              kind: "text-range",
              path: preview.path,
              absolutePath: preview.absolutePath,
              startLine: selectionRange.startLine,
              endLine: selectionRange.endLine,
              snippet: selectionRange.snippet,
              label:
                selectionRange.startLine && selectionRange.endLine
                  ? `${previewBaseName(preview.path)} (${selectionRange.startLine}-${selectionRange.endLine})`
                  : `${previewBaseName(preview.path)} (片段)`,
            })
          }
        />
      ) : null}
      <pre ref={codeBlockRef} className="m-0 min-h-0 border-none bg-transparent px-6 py-5 text-[13px] leading-[1.65]">
        <code
          className={`language-${detectLanguage(preview.path)}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
}

export function WorkspaceFilePreview({
  preview,
  anchor,
  copied,
  onCopy,
  onClose,
  onQuoteSnippet,
  onRevealInFileManager,
  revealInFileManagerLabel,
  initialLineRange,
  taskspaceRoot,
}: WorkspaceFilePreviewProps) {
  const truncated =
    preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code"
      ? preview.truncated
      : false;
  const isEditableMarkdown =
    preview.kind === "markdown" && !truncated && !initialLineRange;
  const textualPreview =
    preview.kind === "text" || preview.kind === "markdown" || preview.kind === "code"
      ? (preview as TextualPreview)
      : null;

  const [viewMode, setViewMode] = useState<TextualViewMode>("preview");
  const [editContent, setEditContent] = useState(textualPreview?.content ?? "");
  const [savedBaseline, setSavedBaseline] = useState(textualPreview?.content ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!textualPreview) return;
    setViewMode("preview");
    setEditContent(textualPreview.content);
    setSavedBaseline(textualPreview.content);
    setSaveError(null);
  }, [textualPreview?.path, textualPreview?.absolutePath, textualPreview?.content]);

  const isDirty = textualPreview != null && editContent !== savedBaseline;

  const persistEditContent = useCallback(async (): Promise<boolean> => {
    if (!textualPreview || !isDirty) return true;
    const api = window.agenticxDesktop?.writeLocalTextFile;
    if (!api) {
      setSaveError("当前客户端不支持保存文件");
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api({ path: textualPreview.absolutePath, content: editContent });
      if (!res.ok) {
        setSaveError(res.error ?? "保存失败");
        return false;
      }
      setSavedBaseline(editContent);
      return true;
    } catch (err) {
      setSaveError(String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [editContent, isDirty, textualPreview]);

  const switchToPreview = useCallback(async () => {
    if (viewMode === "preview") return;
    if (isDirty) {
      const ok = await persistEditContent();
      if (!ok) return;
    }
    setViewMode("preview");
  }, [isDirty, persistEditContent, viewMode]);

  const markdownHostPath = useMemo(() => {
    if (!textualPreview || textualPreview.kind !== "markdown") return "";
    return resolveMarkdownHostPath(
      textualPreview.absolutePath,
      taskspaceRoot,
      textualPreview.path
    );
  }, [textualPreview, taskspaceRoot]);

  const focusLabel =
    initialLineRange && initialLineRange.start === initialLineRange.end
      ? `第 ${initialLineRange.start} 行`
      : initialLineRange
        ? `第 ${initialLineRange.start}–${initialLineRange.end} 行`
        : null;

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
              {focusLabel ? (
                <>
                  <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-text-faint opacity-50" />
                  <span className="shrink-0 text-cyan-400/90">{focusLabel}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-1">
            {isEditableMarkdown ? (
              <>
                <button
                  type="button"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    viewMode === "preview"
                      ? "bg-surface-hover text-text-strong"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  onClick={() => void switchToPreview()}
                  title="预览"
                  aria-pressed={viewMode === "preview"}
                >
                  <Eye className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    viewMode === "edit"
                      ? "bg-surface-hover text-text-strong"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  onClick={() => setViewMode("edit")}
                  title="编辑源码"
                  aria-pressed={viewMode === "edit"}
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <div className="h-4 w-px bg-border opacity-50" />
              </>
            ) : null}
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
              preview={preview as OfficePreview}
              onCopy={onCopy}
              onQuoteSnippet={onQuoteSnippet}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : preview.kind === "binary" ? (
            <BinaryPlaceholderBody
              preview={preview as BinaryLikePreview}
              onCopy={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
            />
          ) : (
            <TextualPreviewBody
              preview={preview as TextualPreview}
              onQuoteSnippet={onQuoteSnippet}
              initialLineRange={initialLineRange}
              viewMode={isEditableMarkdown ? viewMode : "preview"}
              editContent={editContent}
              onEditContentChange={setEditContent}
              markdownHostPath={markdownHostPath}
            />
          )}
        </div>
        {saveError ? (
          <div className="shrink-0 border-t border-border bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
            保存失败：{saveError}
          </div>
        ) : saving ? (
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-2 text-xs text-text-muted">
            正在保存…
          </div>
        ) : isEditableMarkdown && viewMode === "edit" && isDirty ? (
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-2 text-xs text-text-muted">
            有未保存修改；切回预览将自动保存
          </div>
        ) : null}
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
