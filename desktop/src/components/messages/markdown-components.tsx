import type { Components } from "react-markdown";
import type { Element as HastElement, ElementContent } from "hast";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { MermaidBlock } from "./MermaidBlock";

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

/** Shared ReactMarkdown `components` map (GFM + Mermaid fenced blocks). */
export const chatMarkdownComponents: Partial<Components> = {
  pre({ children, node, ...rest }) {
    const fromHast = extractMermaidFromHastPre(node as HastElement | undefined);
    const mermaidSrc = fromHast ?? extractMermaidFromPreChildren(children);
    if (mermaidSrc !== null) {
      return <MermaidBlock code={mermaidSrc} />;
    }
    return <pre {...rest}>{children}</pre>;
  },
};
