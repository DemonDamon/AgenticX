import type { Components } from "react-markdown";
import type { Element as HastElement, ElementContent } from "hast";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { MermaidBlock } from "./MermaidBlock";
import { highlightChatCode } from "./highlight-chat-code";

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
    if (preHast?.tagName === "pre") {
      const codeEl = codeElementFromPreHast(preHast);
      if (codeEl) {
        const lang = languageTokenFromHastClass(codeEl.properties?.className);
        const text = hastTextContent(codeEl).replace(/\n$/, "");
        const html = highlightChatCode(text, lang);
        const codeCls = classNameFromHastProperty(codeEl.properties?.className);
        const wrapClass = ["agx-chat-prism", className].filter(Boolean).join(" ");
        return (
          <pre {...(rest as HTMLAttributes<HTMLPreElement>)} className={wrapClass}>
            <code className={codeCls} dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        );
      }
    }
    const wrapClass = ["agx-chat-prism", className].filter(Boolean).join(" ");
    return (
      <pre {...(rest as HTMLAttributes<HTMLPreElement>)} className={wrapClass}>
        {children}
      </pre>
    );
  },
  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto">
        <table {...rest}>{children}</table>
      </div>
    );
  },
};
