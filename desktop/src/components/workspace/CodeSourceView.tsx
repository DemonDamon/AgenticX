/**
 * Line-numbered, foldable source preview with optional change highlighting.
 *
 * Author: Damon Li
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import Prism from "prismjs";
import "./preview-prism-setup";
import {
  detectFoldRanges,
  guideCoversLine,
  hiddenLinesForFolds,
  visualIndentCols,
  type CodeFoldRange,
} from "./code-source-fold";
import { previewLanguageFromPath } from "./preview-code-language";

const GUIDE_COLORS = ["#e3b341", "#f778ba", "#79c0ff", "#d2a8ff"];

export type CodeSourceFocusRange = {
  start: number;
  end: number;
};

type Props = {
  content: string;
  path: string;
  addedLines?: ReadonlySet<number> | readonly number[];
  focusRange?: CodeSourceFocusRange;
  codeRef?: MutableRefObject<HTMLPreElement | null>;
  /** Fold every detectable block (header「折叠源码」). Source stays visible. */
  foldAll?: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightLines(content: string, language: string): string[] {
  const lines = content.split("\n");
  if (language === "plaintext" || !Prism.languages[language]) {
    return lines.map((line) => escapeHtml(line || " "));
  }
  const grammar = Prism.languages[language] ?? Prism.languages.clike;
  const html = Prism.highlight(content, grammar, language);
  const parts = html.split("\n");
  if (parts.length < lines.length) {
    while (parts.length < lines.length) parts.push("");
  }
  return parts.map((line, i) => (line || (lines[i] ? escapeHtml(lines[i]!) : " ")));
}

function toAddedSet(addedLines?: ReadonlySet<number> | readonly number[]): Set<number> {
  if (!addedLines) return new Set();
  if (addedLines instanceof Set) return addedLines;
  return new Set(addedLines);
}

function coveringGuides(
  lineNo: number,
  ranges: CodeFoldRange[],
  indentByStart: Map<number, number>,
  lineText: string,
): { col: number; color: string }[] {
  const guides: { col: number; color: string }[] = [];
  let depth = 0;
  for (const range of ranges) {
    if (!guideCoversLine(range, lineNo, lineText)) continue;
    const col = indentByStart.get(range.start) ?? 0;
    guides.push({ col, color: GUIDE_COLORS[depth % GUIDE_COLORS.length]! });
    depth += 1;
  }
  return guides;
}

export function previewLineFromNode(node: Node, root: Element): number | null {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el && el !== root) {
    const raw = el.getAttribute("data-preview-line");
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    el = el.parentElement;
  }
  return null;
}

function allFoldStarts(content: string, language: string): Set<number> {
  return new Set(detectFoldRanges(content, language).map((range) => range.start));
}

export function CodeSourceView({
  content,
  path,
  addedLines,
  focusRange,
  codeRef,
  foldAll = false,
}: Props) {
  const language = previewLanguageFromPath(path);
  const rootRef = useRef<HTMLPreElement | null>(null);
  const assignRef = (node: HTMLPreElement | null) => {
    rootRef.current = node;
    if (codeRef) codeRef.current = node;
  };

  const lines = useMemo(() => content.replace(/\r\n/g, "\n").split("\n"), [content]);
  const highlighted = useMemo(() => highlightLines(content.replace(/\r\n/g, "\n"), language), [content, language]);
  const ranges = useMemo(() => detectFoldRanges(content, language), [content, language]);
  const foldByStart = useMemo(() => {
    const map = new Map<number, CodeFoldRange>();
    for (const range of ranges) map.set(range.start, range);
    return map;
  }, [ranges]);
  const indentByStart = useMemo(() => {
    const map = new Map<number, number>();
    for (const range of ranges) {
      map.set(range.start, visualIndentCols(lines[range.start - 1] ?? ""));
    }
    return map;
  }, [lines, ranges]);

  const [folded, setFolded] = useState<Set<number>>(() =>
    foldAll ? allFoldStarts(content, language) : new Set(),
  );
  const foldAllRef = useRef(foldAll);
  useEffect(() => {
    if (foldAll) {
      setFolded(allFoldStarts(content, language));
    } else if (foldAllRef.current) {
      setFolded(new Set());
    }
    foldAllRef.current = foldAll;
  }, [content, foldAll, language]);
  useEffect(() => {
    setFolded((prev) => {
      const next = new Set<number>();
      for (const start of prev) {
        if (foldByStart.has(start)) next.add(start);
      }
      return next;
    });
  }, [foldByStart]);

  const hidden = useMemo(() => hiddenLinesForFolds(ranges, folded), [folded, ranges]);
  const added = useMemo(() => toAddedSet(addedLines), [addedLines]);
  const focusStart = focusRange ? Math.max(1, Math.floor(focusRange.start)) : 0;
  const focusEnd = focusRange ? Math.max(focusStart, Math.floor(focusRange.end)) : 0;

  useEffect(() => {
    if (!focusStart) return;
    let cancelled = false;
    const scrollToLine = (): boolean => {
      const scrollEl = rootRef.current?.closest(".preview-scrollbar") as HTMLElement | null;
      const lineEl = rootRef.current?.querySelector(`[data-preview-line="${focusStart}"]`);
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
  }, [content, focusStart]);

  const toggleFold = (start: number, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  };

  return (
    <pre ref={assignRef} className="agx-code-source">
      {lines.map((_raw, index) => {
        const lineNo = index + 1;
        if (hidden.has(lineNo)) return null;
        const range = foldByStart.get(lineNo);
        const isFolded = Boolean(range && folded.has(lineNo));
        const isAdded = added.has(lineNo);
        const isFocus = focusStart > 0 && lineNo >= focusStart && lineNo <= focusEnd;
        const guides = coveringGuides(lineNo, ranges, indentByStart, lines[index] ?? "");
        return (
          <div
            key={lineNo}
            data-preview-line={lineNo}
            className={`agx-code-line${isAdded ? " agx-code-line--added" : ""}${
              isFocus ? " agx-code-line--focus" : ""
            }`}
          >
            <span className="agx-code-gutter">
              <span className="agx-code-gutter-bar" aria-hidden />
              {range ? (
                <button
                  type="button"
                  className="agx-code-fold"
                  aria-expanded={!isFolded}
                  aria-label={isFolded ? "展开此范围" : "折叠此范围"}
                  title={isFolded ? "展开此范围" : "折叠此范围"}
                  onClick={(event) => toggleFold(lineNo, event)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    {isFolded ? (
                      <path d="M3.2 1.6 7.2 5 3.2 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    ) : (
                      <path d="M1.6 3.2 5 7.2 8.4 3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    )}
                  </svg>
                </button>
              ) : (
                <span className="agx-code-fold-spacer" aria-hidden />
              )}
              <span className="agx-code-lineno">{lineNo}</span>
            </span>
            <span className="agx-code-text">
              {guides.map((guide, guideIdx) => (
                <span
                  key={`${lineNo}-g-${guideIdx}`}
                  className="agx-code-indent"
                  style={{ left: `${guide.col}ch`, background: guide.color }}
                  aria-hidden
                />
              ))}
              <span dangerouslySetInnerHTML={{ __html: highlighted[index] || " " }} />
              {isFolded ? (
                <button
                  type="button"
                  className="agx-code-ellipsis"
                  title="点击展开此范围"
                  onClick={(event) => toggleFold(lineNo, event)}
                >
                  …
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </pre>
  );
}
