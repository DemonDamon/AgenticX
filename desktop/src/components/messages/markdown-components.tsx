import type { Components } from "react-markdown";
import type { Element as HastElement, ElementContent } from "hast";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { useEffect, useMemo, useState, createContext, useContext } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Copy, Check, Quote, Maximize2, ChevronDown, ChevronUp } from "lucide-react";
import { MermaidBlock } from "./MermaidBlock";
import { highlightChatCode } from "./highlight-chat-code";
import { Modal } from "../ds/Modal";
import { HoverTip } from "../ds/HoverTip";

export const MarkdownContext = createContext<{
  isStreaming?: boolean;
  onQuoteText?: (text: string) => void;
}>({});

const MERMAID_LANG = new Set(["mermaid", "mmd"]);
/** 无语言或通用代码块：仅当正文明显为 Mermaid 时才接管 */
const TREAT_AS_PLAIN_LANG = new Set(["", "text", "plaintext", "plain"]);

const MERMAID_BODY_START =
  /^\s*(?:sequenceDiagram|classDiagram|flowchart(?:\s+)?(?:TB|BT|RL|LR|TD)?|graph\s+(?:TD|LR|TB|BT|RL)|stateDiagram(?:-v2)?|erDiagram|gantt|journey|gitgraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey(?:-beta)?|xychart(?:-beta)?|block-(?:beta|batch)|architecture|c4context|c4container|c4component|pie(?:\s|$)|kanban)/i;

function hastTextContent(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" && node.children?.length) {
    return node.children.map((c) => hastTextContent(c)).join("");
  }
  return "";
}

function languageTokenFromHastClass(cls: unknown): string | null {
  if (cls == null) return null;
  const raw = Array.isArray(cls) ? cls.join(" ") : String(cls);
  const m = raw.match(/language-([^\s]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function shouldRenderMermaid(lang: string | null, bodyTrimmed: string): boolean {
  if (!bodyTrimmed) return false;
  if (lang && MERMAID_LANG.has(lang)) return true;
  if (lang == null || TREAT_AS_PLAIN_LANG.has(lang)) {
    return MERMAID_BODY_START.test(bodyTrimmed);
  }
  return false;
}

function extractMermaidFromHastPre(pre: HastElement | undefined): string | null {
  if (!pre || pre.type !== "element" || pre.tagName !== "pre") return null;
  const codeEl = pre.children?.find(
    (c): c is HastElement =>
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      (c as HastElement).type === "element" &&
      (c as HastElement).tagName === "code",
  );
  if (!codeEl) return null;
  const lang = languageTokenFromHastClass(codeEl.properties?.className);
  const text = hastTextContent(codeEl).replace(/\n$/, "");
  const trimmed = text.trim();
  if (!shouldRenderMermaid(lang, trimmed)) return null;
  return text;
}

function reactNodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join("");
  if (isValidElement(node)) return reactNodeToPlainText(node.props.children);
  return "";
}

/** 当 HAST node 不可用时，从 pre 的子节点解析（兼容 className 大小写、多段 children） */
function extractMermaidFromPreChildren(children: ReactNode): string | null {
  const arr = Children.toArray(children).filter(
    (c) => !(typeof c === "string" && c.trim() === ""),
  );
  const codeEl = arr.find(
    (c): c is ReactElement<{ className?: string; children?: ReactNode }> =>
      isValidElement(c) && typeof c.type === "string" && c.type === "code",
  );
  if (!codeEl) return null;
  const cls = String(codeEl.props.className ?? "");
  const langMatch = cls.match(/language-([^\s]+)/i);
  const lang = langMatch ? langMatch[1].toLowerCase() : null;
  const text = reactNodeToPlainText(codeEl.props.children).replace(/\n$/, "");
  const trimmed = text.trim();
  if (!shouldRenderMermaid(lang, trimmed)) return null;
  return text;
}

function codeElementFromPreHast(pre: HastElement): HastElement | undefined {
  return pre.children?.find(
    (c): c is HastElement =>
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      (c as HastElement).type === "element" &&
      (c as HastElement).tagName === "code",
  );
}

function classNameFromHastProperty(cls: unknown): string | undefined {
  if (cls == null) return undefined;
  return Array.isArray(cls) ? cls.join(" ") : String(cls);
}

function normalizeLatexMathDelimitersInText(text: string): string {
  let next = text;
  // Convert LaTeX delimiters to remark-math syntax.
  next = next.replace(/\\\[((?:.|\n)*?)\\\]/g, (_whole, expr: string) => {
    const inner = expr.trim();
    return inner ? `$$\n${inner}\n$$` : _whole;
  });
  next = next.replace(/\\\((.+?)\\\)/g, (_whole, expr: string) => {
    const inner = expr.trim();
    return inner ? `$${inner}$` : _whole;
  });
  return next;
}

function normalizeMarkdownImageSrc(raw?: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(value)) return value;
  // Keep bundled frontend assets unchanged.
  if (value.startsWith("/assets/")) return value;
  // Convert absolute local filesystem path to file:// URL.
  if (value.startsWith("/")) return `file://${encodeURI(value)}`;
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    const normalized = value.replace(/\\/g, "/");
    return `file:///${encodeURI(normalized)}`;
  }
  return value;
}

function isLocalMarkdownImageSrc(raw?: string): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (value.startsWith("file://")) return true;
  if (value.startsWith("/")) return !value.startsWith("/assets/");
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function localPathFromMarkdownImageSrc(raw?: string): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("file://")) return value;
  return value;
}

/**
 * ReactMarkdown 默认会过滤 file:// 协议，导致本地图片 src 变成空字符串。
 * 这里显式放行常见安全协议，并拒绝脚本协议。
 */
export function chatUrlTransform(raw?: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("#")) {
    return value;
  }
  const m = value.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
  if (!m) return value;
  const protocol = m[1].toLowerCase();
  if (["http", "https", "mailto", "tel", "file", "data", "blob"].includes(protocol)) return value;
  return "";
}

function MarkdownImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [loadError, setLoadError] = useState("");
  const normalizedSrc = useMemo(() => normalizeMarkdownImageSrc(src), [src]);
  const displaySrc = resolvedSrc || normalizedSrc;

  useEffect(() => {
    let alive = true;
    setLoadError("");

    if (!normalizedSrc) {
      setResolvedSrc("");
      return () => {
        alive = false;
      };
    }

    if (!isLocalMarkdownImageSrc(src)) {
      setResolvedSrc(normalizedSrc);
      return () => {
        alive = false;
      };
    }

    const api = window.agenticxDesktop?.loadLocalImageDataUrl;
    if (!api) {
      setResolvedSrc(normalizedSrc);
      setLoadError("当前运行环境无法读取本地图片");
      return () => {
        alive = false;
      };
    }

    setResolvedSrc("");
    void api(localPathFromMarkdownImageSrc(src)).then((res) => {
      if (!alive) return;
      if (res?.ok && res.dataUrl) {
        setResolvedSrc(res.dataUrl);
        return;
      }
      setResolvedSrc(normalizedSrc);
      setLoadError(res?.error || "本地图片读取失败");
    });

    return () => {
      alive = false;
    };
  }, [normalizedSrc, src]);

  if (!normalizedSrc) return <span className="text-text-faint">[图片地址为空]</span>;

  return (
    <>
      <button
        type="button"
        className="group my-1 block overflow-hidden rounded-xl border border-border bg-surface-panel text-left"
        title={title || alt || "点击查看原图"}
        onClick={() => setOpen(true)}
      >
        <img
          src={displaySrc}
          alt={alt || "image"}
          className="max-h-[220px] w-auto max-w-[280px] object-cover transition group-hover:scale-[1.01]"
          loading="lazy"
        />
        <div className="px-2 py-1 text-[11px] text-text-faint">
          {loadError ? `图片预览失败：${loadError}` : alt || title || "图片预览"}
        </div>
      </button>
      <Modal open={open} title={alt || title || "图片预览"} onClose={() => setOpen(false)}>
        <div className="flex max-h-[72vh] items-center justify-center overflow-auto">
          <img src={displaySrc} alt={alt || "image"} className="h-auto max-h-[68vh] w-auto max-w-full rounded-lg" />
        </div>
      </Modal>
    </>
  );
}

function CodeBlockComponent({
  text,
  lang,
  html,
  children,
  codeCls,
  wrapClass,
  rest,
}: {
  text: string;
  lang: string | null;
  html?: string;
  children?: ReactNode;
  codeCls?: string;
  wrapClass: string;
  rest: any;
}) {
  const { isStreaming, onQuoteText } = useContext(MarkdownContext);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (isStreaming && !expanded) {
      setExpanded(true);
    }
  }, [isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group my-2 flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface-hover/50 px-3 text-xs text-text-faint transition">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider">{lang || "text"}</span>
          <HoverTip label={expanded ? "收起" : "展开"}>
            <button
              type="button"
              className="flex items-center justify-center rounded p-0.5 hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </HoverTip>
        </div>
        {!isStreaming && (
          <div className="flex items-center gap-1 text-text-faint transition-opacity">
            <HoverTip label="复制">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </HoverTip>
            {onQuoteText && (
              <HoverTip label="引用">
                <button
                  type="button"
                  onClick={() => onQuoteText(text)}
                  className="flex items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                >
                  <Quote size={12} />
                </button>
              </HoverTip>
            )}
            <HoverTip label="放大查看">
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                className="flex items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              >
                <Maximize2 size={12} />
              </button>
            </HoverTip>
          </div>
        )}
      </div>
      {expanded && (
        <div className="overflow-x-auto p-3 text-[13px]">
          <pre {...rest} className={wrapClass} style={{ margin: 0, padding: 0, background: "transparent", border: "none" }}>
            {html ? (
              <code className={codeCls} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <code className={codeCls}>{children}</code>
            )}
          </pre>
        </div>
      )}
      <Modal open={fullscreen} title={`查看代码 (${lang || "text"})`} onClose={() => setFullscreen(false)} panelClassName="max-w-4xl w-[90vw] bg-surface-panel">
        <div className="max-h-[75vh] overflow-auto rounded-lg text-[14px]">
          <pre {...rest} className={wrapClass} style={{ margin: 0, padding: 0, background: "transparent", border: "none" }}>
            {html ? (
              <code className={codeCls} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <code className={codeCls}>{children}</code>
            )}
          </pre>
        </div>
      </Modal>
    </div>
  );
}

export function normalizeChatMarkdownContent(raw: string): string {
  if (!raw) return raw;
  // Keep fenced code blocks untouched to avoid rewriting code snippets.
  const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  const chunks = raw.split(FENCED_BLOCK_RE);
  return chunks
    .map((chunk, idx) => (idx % 2 === 1 ? chunk : normalizeLatexMathDelimitersInText(chunk)))
    .join("");
}

/** Shared ReactMarkdown `components` map (GFM + Mermaid fenced blocks). */
export const chatRemarkPlugins = [remarkGfm, remarkMath];
export const chatRehypePlugins = [rehypeKatex];

/** Shared ReactMarkdown `components` map (GFM + Mermaid fenced blocks). */
export const chatMarkdownComponents: Partial<Components> = {
  pre({ children, node, className, ...rest }) {
    const fromHast = extractMermaidFromHastPre(node as HastElement | undefined);
    const mermaidSrc = fromHast ?? extractMermaidFromPreChildren(children);
    if (mermaidSrc !== null) {
      return <MermaidBlock code={mermaidSrc} />;
    }
    const preHast = node as HastElement | undefined;
    const wrapClass = ["agx-chat-prism", className].filter(Boolean).join(" ");
    
    if (preHast?.tagName === "pre") {
      const codeEl = codeElementFromPreHast(preHast);
      if (codeEl) {
        const lang = languageTokenFromHastClass(codeEl.properties?.className);
        const text = hastTextContent(codeEl).replace(/\n$/, "");
        const html = highlightChatCode(text, lang);
        const codeCls = classNameFromHastProperty(codeEl.properties?.className);
        return (
          <CodeBlockComponent
            text={text}
            lang={lang}
            html={html}
            codeCls={codeCls}
            wrapClass={wrapClass}
            rest={rest}
          />
        );
      }
    }
    
    const fallbackText = reactNodeToPlainText(children).replace(/\n$/, "");
    return (
      <CodeBlockComponent
        text={fallbackText}
        lang={null}
        children={children}
        wrapClass={wrapClass}
        rest={rest}
      />
    );
  },
  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto">
        <table {...rest}>{children}</table>
      </div>
    );
  },
  img({ src, alt, title }) {
    return <MarkdownImage src={src} alt={alt} title={title} />;
  },
};
