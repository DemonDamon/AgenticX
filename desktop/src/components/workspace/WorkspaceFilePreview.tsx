import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  ImageIcon,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Search,
  Undo2,
  X,
} from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
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
  previewCopyText,
  type WorkspacePreviewLineRange,
  type WorkspacePreviewQuotePayload,
  type WorkspacePreview,
} from "./workspace-preview-types";
import { DocxPreview } from "./DocxPreview";
import { HtmlPreviewBody, isHtmlPreviewPath } from "./HtmlPreviewBody";
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
  /**
   * popover = Codex-style floating panel anchored left of workspace (legacy).
   * panel = Trae-style fill the WorkPanel preview tab (no left popup).
   */
  layout?: "popover" | "panel";
  /** Required when layout is popover. */
  anchor?: { top: number; bottom: number; left: number };
  copied: boolean;
  onCopy: (text?: string) => void;
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
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "markup";
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
  enableZoom = false,
}: {
  absolutePath: string;
  onCopy: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
  /** Trae-style floating zoom control for panel layout. */
  enableZoom?: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataUrl(null);
    setZoom(100);
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

  const scale = enableZoom ? zoom / 100 : 1;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface-base">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="flex min-h-full items-center justify-center">
          <img
            src={dataUrl}
            alt=""
            className="rounded-lg object-contain"
            style={
              enableZoom
                ? { width: `${Math.round(scale * 100)}%`, maxWidth: "none", height: "auto" }
                : { maxHeight: "100%", maxWidth: "100%" }
            }
          />
        </div>
      </div>
      {enableZoom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface-card/95 px-2 py-1 shadow-lg backdrop-blur">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              title="缩小"
              aria-label="缩小"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <span className="min-w-[3.2rem] text-center text-[12px] tabular-nums text-text-strong">
              {zoom}%
            </span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setZoom((z) => Math.min(300, z + 25))}
              title="放大"
              aria-label="放大"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}
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

const EDIT_HISTORY_LIMIT = 200;

type EditHistoryState = {
  entries: string[];
  index: number;
};

function useTextEditHistory(initialContent: string, resetKey: string) {
  const [history, setHistory] = useState<EditHistoryState>({
    entries: [initialContent],
    index: 0,
  });

  useEffect(() => {
    setHistory({ entries: [initialContent], index: 0 });
  }, [resetKey, initialContent]);

  const value = history.entries[history.index] ?? initialContent;

  const setValue = useCallback((next: string) => {
    setHistory((prev) => {
      const base = prev.entries.slice(0, prev.index + 1);
      if (base[base.length - 1] === next) return prev;
      const entries = [...base, next];
      if (entries.length > EDIT_HISTORY_LIMIT) {
        entries.splice(0, entries.length - EDIT_HISTORY_LIMIT);
      }
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) =>
      prev.index < prev.entries.length - 1 ? { ...prev, index: prev.index + 1 } : prev
    );
  }, []);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  return { value, setValue, undo, redo, canUndo, canRedo };
}

/**
 * Map visually-identical / OS-substituted punctuation to a single canonical
 * character so that macOS "smart" dash/quote substitution (which can happen
 * either in the file's saved content or transiently while typing into an
 * Electron/Chromium text field) never causes an otherwise-correct find query
 * to silently fail to match.
 *
 * IMPORTANT: every substitution below is exactly 1 character → 1 character,
 * so the normalized string has the SAME LENGTH as the input and match
 * indices found in the normalized string remain valid offsets into the
 * original (un-normalized) string.
 */
function normalizeForSearch(s: string): string {
  return s
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFF0D\u2212]/g, "-") // hyphen/en/em/figure/fullwidth/minus dashes
    .replace(/[\u00A0\u2007\u202F]/g, " ") // no-break / figure / narrow-no-break space
    .replace(/[\u2018\u2019\u201B]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D\u201F]/g, '"'); // smart double quotes
}

/** Normalize line endings only; preserve leading/trailing newlines in the query. */
function sanitizeFindQuery(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

function isEmptyFindQuery(raw: string): boolean {
  return sanitizeFindQuery(raw).trim().length === 0;
}

/** Keep the editor selection verbatim (including blank lines / newlines). */
function selectionToFindQuery(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

function formatFindQueryForDisplay(query: string): string {
  if (!query.includes("\n")) return query;
  return query.replace(/\n/g, "↵");
}

/** Normalize line endings in replace text; preserve literal newlines typed in the box. */
function sanitizeReplaceText(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

function findTextMatch(
  content: string,
  query: string,
  from: number,
  forward: boolean
): { start: number; end: number } | null {
  if (!query || !content) return null;
  const normContent = normalizeForSearch(content);
  const normQuery = normalizeForSearch(query);
  if (forward) {
    // Start after current position; wrap around if needed
    const searchFrom = Math.max(0, from);
    let idx = normContent.indexOf(normQuery, searchFrom);
    if (idx < 0) idx = normContent.indexOf(normQuery, 0); // wrap
    return idx >= 0 ? { start: idx, end: idx + normQuery.length } : null;
  }
  // Backward search: start before current position; wrap around if needed
  const searchFrom = Math.max(0, from - normQuery.length);
  let idx = normContent.lastIndexOf(normQuery, searchFrom);
  if (idx < 0) idx = normContent.lastIndexOf(normQuery); // wrap
  return idx >= 0 ? { start: idx, end: idx + normQuery.length } : null;
}

function countMatches(content: string, query: string): number {
  if (!query || !content) return 0;
  const normContent = normalizeForSearch(content);
  const normQuery = normalizeForSearch(query);
  let count = 0;
  let idx = 0;
  while ((idx = normContent.indexOf(normQuery, idx)) >= 0) {
    count += 1;
    idx += normQuery.length;
  }
  return count;
}

/**
 * Replace all occurrences of `find` (matched leniently via normalizeForSearch,
 * so em-dash/en-dash/smart-quote variants in the file are matched too) with
 * `replace`, preserving every non-matched original character exactly as-is.
 */
function replaceAllOccurrences(
  content: string,
  find: string,
  replace: string
): { result: string; count: number } {
  if (!find) return { result: content, count: 0 };
  const normContent = normalizeForSearch(content);
  const normFind = normalizeForSearch(find);
  if (!normFind) return { result: content, count: 0 };
  let count = 0;
  let cursor = 0;
  let result = "";
  let idx = normContent.indexOf(normFind, cursor);
  while (idx >= 0) {
    result += content.slice(cursor, idx) + replace;
    cursor = idx + normFind.length;
    count += 1;
    idx = normContent.indexOf(normFind, cursor);
  }
  result += content.slice(cursor);
  return { result, count };
}

function TextualPreviewBody({
  preview,
  onQuoteSnippet,
  initialLineRange,
  viewMode,
  editContent,
  onEditContentChange,
  markdownHostPath,
  textareaRef,
  renderHtml,
}: {
  preview: TextualPreview;
  onQuoteSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
  initialLineRange?: WorkspacePreviewLineRange;
  viewMode: TextualViewMode;
  editContent: string;
  onEditContentChange: (value: string) => void;
  markdownHostPath: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** When true and viewMode is preview, render HTML via sandboxed iframe. */
  renderHtml?: boolean;
}) {
  const showHtmlRender = !!renderHtml && viewMode === "preview" && !initialLineRange;

  const highlightedCode = useMemo(() => {
    if (preview.kind === "markdown" || showHtmlRender) return "";
    const language = detectLanguage(preview.path);
    const grammar = Prism.languages[language] ?? Prism.languages.clike;
    return Prism.highlight(preview.content, grammar, language);
  }, [preview, showHtmlRender]);

  const markdownContent = useMemo(() => {
    if (preview.kind !== "markdown") return "";
    const lower = preview.path.toLowerCase();
    // Raw Mermaid sources (.mmd) render as a diagram, not a plain code dump.
    if (lower.endsWith(".mmd")) {
      const trimmed = editContent.trim();
      if (/^```(?:mermaid|mmd)\b/i.test(trimmed)) {
        return normalizeChatMarkdownContent(editContent);
      }
      const body = editContent.replace(/\s+$/, "");
      return normalizeChatMarkdownContent(`\`\`\`mermaid\n${body}\n\`\`\``);
    }
    return normalizeChatMarkdownContent(editContent);
  }, [preview.kind, preview.path, editContent]);
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

  if (initialLineRange) {
    return <LineFocusedSourceView content={preview.content} lineRange={initialLineRange} />;
  }

  if (showHtmlRender) {
    return (
      <HtmlPreviewBody
        content={preview.content}
        title={previewBaseName(preview.path)}
        documentPath={preview.absolutePath}
      />
    );
  }

  if (preview.kind === "markdown" && viewMode === "edit") {
    return (
      <textarea
        ref={textareaRef}
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
  layout = "popover",
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
  const isPanel = layout === "panel";
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
  const isHtmlFile =
    textualPreview != null && isHtmlPreviewPath(textualPreview.path) && !initialLineRange;

  const editResetKey = textualPreview
    ? `${textualPreview.absolutePath}:${textualPreview.content.length}`
    : "";

  const {
    value: editContent,
    setValue: setEditContent,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTextEditHistory(textualPreview?.content ?? "", editResetKey);

  const [viewMode, setViewMode] = useState<TextualViewMode>("preview");
  const [savedBaseline, setSavedBaseline] = useState(textualPreview?.content ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findStatus, setFindStatus] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState("");
  const saveToastTimerRef = useRef<number | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const findInputRef = useRef<HTMLTextAreaElement | null>(null);

  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    if (saveToastTimerRef.current !== null) {
      window.clearTimeout(saveToastTimerRef.current);
    }
    saveToastTimerRef.current = window.setTimeout(() => {
      setSaveToast("");
      saveToastTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(
    () => () => {
      if (saveToastTimerRef.current !== null) {
        window.clearTimeout(saveToastTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!textualPreview) return;
    setViewMode("preview");
    setSavedBaseline(textualPreview.content);
    setSaveError(null);
    setFindBarOpen(false);
    setFindText("");
    setReplaceText("");
    setFindStatus(null);
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

  const handleSave = useCallback(async () => {
    if (!isEditableMarkdown || viewMode !== "edit") return;
    if (!isDirty) {
      showSaveToast("已是最新");
      return;
    }
    const ok = await persistEditContent();
    if (ok) {
      showSaveToast("已保存");
    } else {
      showSaveToast("保存失败");
    }
  }, [isDirty, isEditableMarkdown, persistEditContent, showSaveToast, viewMode]);

  const switchToPreview = useCallback(async () => {
    if (viewMode === "preview") return;
    if (isDirty) {
      const ok = await persistEditContent();
      if (!ok) return;
    }
    setViewMode("preview");
  }, [isDirty, persistEditContent, viewMode]);

  const selectTextRange = useCallback((start: number, end: number) => {
    const textarea = editTextareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(start, end);
  }, []);

  const findInputRows = useMemo(
    () => Math.min(5, Math.max(1, findText.split("\n").length)),
    [findText]
  );
  const replaceInputRows = useMemo(
    () => Math.min(5, Math.max(1, replaceText.split("\n").length)),
    [replaceText]
  );

  const runFind = useCallback(
    (forward: boolean) => {
      const query = sanitizeFindQuery(findText);
      if (isEmptyFindQuery(query)) {
        setFindStatus("请输入查找内容");
        return;
      }

      const textarea = editTextareaRef.current;
      // For forward: start searching after the end of current selection (skip current match)
      // For backward: start searching before the start of current selection
      const from = forward
        ? (textarea?.selectionEnd ?? 0) + 1
        : (textarea?.selectionStart ?? editContent.length) - 1;

      const match = findTextMatch(editContent, query, Math.max(0, from), forward);
      if (!match) {
        setFindStatus(`未找到「${formatFindQueryForDisplay(query)}」`);
        return;
      }
      selectTextRange(match.start, match.end);
      const total = countMatches(editContent, query);
      const actual = editContent.slice(match.start, match.end);
      setFindStatus(
        actual !== query
          ? `（文档中为「${formatFindQueryForDisplay(actual)}」，共 ${total} 处）`
          : total > 1
            ? `共 ${total} 处`
            : null
      );
    },
    [editContent, findText, selectTextRange]
  );

  const runReplaceOne = useCallback(() => {
    const query = sanitizeFindQuery(findText);
    if (isEmptyFindQuery(query)) {
      setFindStatus("请输入查找内容");
      return;
    }
    const replacement = sanitizeReplaceText(replaceText);

    const textarea = editTextareaRef.current;
    const selStart = textarea?.selectionStart ?? 0;
    const selEnd = textarea?.selectionEnd ?? 0;
    // If there is a non-empty selection, replace it directly regardless of how it was matched
    if (selStart < selEnd) {
      const next =
        editContent.slice(0, selStart) + replacement + editContent.slice(selEnd);
      setEditContent(next);
      const cursor = selStart + replacement.length;
      window.requestAnimationFrame(() => selectTextRange(cursor, cursor));
      setFindStatus(null);
      return;
    }
    // No selection yet → find first
    runFind(true);
  }, [editContent, findText, replaceText, runFind, selectTextRange, setEditContent]);

  const runReplaceAll = useCallback(() => {
    const query = sanitizeFindQuery(findText);
    if (isEmptyFindQuery(query)) {
      setFindStatus("请输入查找内容");
      return;
    }
    const replacement = sanitizeReplaceText(replaceText);

    const { result, count } = replaceAllOccurrences(editContent, query, replacement);
    if (count <= 0) {
      setFindStatus(`未找到「${formatFindQueryForDisplay(query)}」`);
      return;
    }
    setEditContent(result);
    setFindStatus(`已替换 ${count} 处`);
  }, [editContent, findText, replaceText, setEditContent]);

  const openFindBar = useCallback(
    (prefillFromSelection = false) => {
      if (prefillFromSelection) {
        const textarea = editTextareaRef.current;
        const selStart = textarea?.selectionStart ?? 0;
        const selEnd = textarea?.selectionEnd ?? 0;
        if (textarea && selStart < selEnd) {
          const selected = editContent.slice(selStart, selEnd);
          setFindText(selectionToFindQuery(selected));
          setFindStatus(null);
        }
      }
      setFindBarOpen(true);
      window.requestAnimationFrame(() => findInputRef.current?.focus());
    },
    [editContent]
  );

  const handleCopyClick = useCallback(() => {
    const text = textualPreview ? editContent : previewCopyText(preview);
    onCopy(text);
  }, [editContent, onCopy, preview, textualPreview]);

  useEffect(() => {
    if (!isEditableMarkdown || viewMode !== "edit") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "z" && e.shiftKey || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFindBar(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, isEditableMarkdown, openFindBar, redo, undo, viewMode]);

  useEffect(() => {
    if (findBarOpen) {
      window.requestAnimationFrame(() => findInputRef.current?.focus());
    }
  }, [findBarOpen]);

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

  if (!isPanel && !anchor) {
    return null;
  }

  const shell = (
      <div
        role="dialog"
        aria-label={`预览 ${previewBaseName(preview.path)}`}
        className={
          isPanel
            ? "flex h-full min-h-0 flex-col overflow-hidden bg-surface-sidebar"
            : "animate-preview-pop fixed z-[56] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-surface-popover shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]"
        }
        style={
          isPanel || !anchor
            ? undefined
            : {
                top: anchor.top + 8,
                bottom: Math.max(8, window.innerHeight - anchor.bottom + 8),
                right: Math.max(8, window.innerWidth - anchor.left + 8),
                width: Math.min(760, Math.max(420, anchor.left - 24)),
                transformOrigin: "right center",
              }
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 ${
            isPanel ? "bg-surface-sidebar" : "bg-surface-popover"
          }`}
        >
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
          {saveToast ? (
            <div
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                saveToast === "保存失败"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {saveToast === "保存失败" ? (
                <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              ) : (
                <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              )}
              {saveToast}
            </div>
          ) : saving ? (
            <div className="shrink-0 text-[11px] text-text-muted">保存中…</div>
          ) : null}
          <div className="ml-2 flex shrink-0 items-center gap-1">
            {isHtmlFile ? (
              <>
                <button
                  type="button"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    viewMode === "preview"
                      ? "bg-surface-hover text-text-strong"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  onClick={() => setViewMode("preview")}
                  title="渲染预览"
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
                  title="查看源码"
                  aria-pressed={viewMode === "edit"}
                >
                  <Code2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <div className="h-4 w-px bg-border opacity-50" />
              </>
            ) : null}
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
                {viewMode === "edit" ? (
                  <>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={undo}
                      disabled={!canUndo}
                      title="撤销 (⌘Z)"
                    >
                      <Undo2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={redo}
                      disabled={!canRedo}
                      title="重做 (⌘⇧Z)"
                    >
                      <Redo2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                        findBarOpen
                          ? "bg-surface-hover text-text-strong"
                          : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                      }`}
                      onClick={() => {
                        if (findBarOpen) {
                          setFindBarOpen(false);
                          return;
                        }
                        openFindBar(true);
                      }}
                      title="查找替换 (⌘F)"
                      aria-pressed={findBarOpen}
                    >
                      <Search className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </>
                ) : null}
                <div className="h-4 w-px bg-border opacity-50" />
              </>
            ) : null}
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
              onClick={handleCopyClick}
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
        {isEditableMarkdown && viewMode === "edit" && findBarOpen ? (
          <div className="flex shrink-0 flex-wrap items-start gap-2 border-b border-border bg-surface-panel px-4 py-2">
            <textarea
              ref={findInputRef}
              rows={findInputRows}
              value={findText}
              onChange={(e) => {
                setFindText(e.target.value);
                setFindStatus(null);
              }}
              onPaste={(e) => {
                e.preventDefault();
                const pasted = e.clipboardData.getData("text/plain");
                setFindText(selectionToFindQuery(pasted));
                setFindStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runFind(!e.shiftKey);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFindBarOpen(false);
                }
              }}
              placeholder="查找（支持多行，含前后换行）"
              autoCorrect="off"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-[120px] flex-1 resize-none rounded-md border border-[var(--border-subtle)] bg-surface-base px-2.5 py-1.5 font-mono text-xs leading-relaxed text-text-primary outline-none focus:border-cyan-500/50"
              aria-label="查找内容"
            />
            <textarea
              rows={replaceInputRows}
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runReplaceOne();
                }
              }}
              placeholder="替换为（Shift+Enter 换行）"
              autoCorrect="off"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-[120px] flex-1 resize-none rounded-md border border-[var(--border-subtle)] bg-surface-base px-2.5 py-1.5 font-mono text-xs leading-relaxed text-text-primary outline-none focus:border-cyan-500/50"
              aria-label="替换内容"
            />
            <button
              type="button"
              className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
              onClick={() => runFind(false)}
            >
              上一个
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
              onClick={() => runFind(true)}
            >
              下一个
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
              onClick={runReplaceOne}
            >
              替换
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
              onClick={runReplaceAll}
            >
              全部替换
            </button>
            {findStatus ? (
              <span className="w-full text-[11px] text-text-muted">{findStatus}</span>
            ) : null}
          </div>
        ) : null}
        <div
          className={`preview-scrollbar min-h-0 flex-1 bg-surface-base ${
            isHtmlFile && viewMode === "preview" ? "overflow-hidden" : "overflow-auto"
          }`}
        >
          {preview.kind === "image" ? (
            <ImagePreviewBody
              absolutePath={preview.absolutePath}
              onCopy={onCopy}
              onRevealInFileManager={onRevealInFileManager}
              revealInFileManagerLabel={revealInFileManagerLabel}
              enableZoom={isPanel}
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
              viewMode={isEditableMarkdown || isHtmlFile ? viewMode : "preview"}
              editContent={editContent}
              onEditContentChange={setEditContent}
              markdownHostPath={markdownHostPath}
              textareaRef={editTextareaRef}
              renderHtml={isHtmlFile}
            />
          )}
        </div>
        {saveError ? (
          <div className="shrink-0 border-t border-border bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
            保存失败：{saveError}
          </div>
        ) : isEditableMarkdown && viewMode === "edit" && isDirty && !saving ? (
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-2 text-xs text-text-muted">
            有未保存修改 · ⌘S 保存 · ⌘Z 撤销 · ⌘F 查找替换
          </div>
        ) : null}
        {truncated ? (
          <div className="shrink-0 border-t border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-500/90">
            文件过大，已截断显示（{formatPreviewBytes(preview.size)}）。
          </div>
        ) : null}
      </div>
  );

  if (isPanel) {
    return shell;
  }

  return createPortal(
    <>
      <div
        className="fixed z-[55]"
        style={{
          top: 0,
          bottom: 0,
          left: 0,
          right: Math.max(0, window.innerWidth - (anchor?.left ?? 0)),
        }}
        onMouseDown={onClose}
        aria-hidden
      />
      {shell}
    </>,
    document.body,
  );
}
