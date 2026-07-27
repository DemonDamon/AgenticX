import * as React from "react";
import type { Components } from "react-markdown";
import type { WebSearchSource } from "@agenticx/core-api";
import { FencedCodeBlock } from "./FencedCodeBlock";
import { WebSearchCitation } from "../components/molecules/WebSearchCitation";
import {
  resolveCitationSource,
  splitCitationText,
} from "../utils/web-search-citation";

function reactNodeToPlainText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return reactNodeToPlainText(node.props.children);
  }
  return "";
}

function languageFromClassName(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/language-([\w+-]+)/);
  return match?.[1] ?? null;
}

function injectCitations(
  children: React.ReactNode,
  sources: WebSearchSource[] | undefined,
  onOpenInSheet?: (index1Based: number) => void,
): React.ReactNode {
  if (!sources?.length) return children;

  const mapNode = (node: React.ReactNode, keyPrefix: string): React.ReactNode => {
    if (node == null || typeof node === "boolean") return node;
    if (typeof node === "number") return node;
    if (typeof node === "string") {
      const parts = splitCitationText(node, sources);
      if (parts.length === 1 && parts[0]?.type === "text") return node;
      return parts.map((part, i) => {
        if (part.type === "text") {
          return <React.Fragment key={`${keyPrefix}-t-${i}`}>{part.value}</React.Fragment>;
        }
        const source = resolveCitationSource(sources, part.index1Based ?? 0);
        if (!source || !part.index1Based) {
          return <React.Fragment key={`${keyPrefix}-f-${i}`}>{part.value}</React.Fragment>;
        }
        return (
          <WebSearchCitation
            key={`${keyPrefix}-c-${i}-${part.index1Based}`}
            index1Based={part.index1Based}
            source={source}
            onOpenInSheet={onOpenInSheet}
          />
        );
      });
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => mapNode(child, `${keyPrefix}-${i}`));
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
      // Do not rewrite fenced code / inline code contents
      const type = node.type;
      if (type === "code" || type === "pre") return node;
      if (node.props.children == null) return node;
      return React.cloneElement(node, {
        ...node.props,
        children: mapNode(node.props.children, `${keyPrefix}-ch`),
      });
    }
    return node;
  };

  return mapNode(children, "cite");
}

type AssistantMdOptions = {
  sources?: WebSearchSource[];
  onOpenCitationInSheet?: (index1Based: number) => void;
};

export function createAssistantMdComponents(options: AssistantMdOptions = {}): Components {
  const wrap =
    (Tag: "h1" | "h2" | "h3" | "p", className: string) =>
    ({ children }: { children?: React.ReactNode }) => {
      const content = injectCitations(children, options.sources, options.onOpenCitationInSheet);
      return React.createElement(Tag, { className }, content);
    };

  return {
    h1: wrap("h1", "mb-2 mt-3 text-balance pl-0 text-xl font-semibold first:mt-0"),
    h2: wrap("h2", "mb-1.5 mt-3 text-balance pl-0 text-lg font-semibold first:mt-0"),
    h3: wrap("h3", "mb-1.5 mt-2 text-balance pl-0 text-base font-semibold first:mt-0"),
    p: wrap("p", "mb-2.5 pl-0 last:mb-0"),
    ul: ({ children }) => (
      <ul className="mb-2.5 list-inside list-disc pl-0 last:mb-0">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2.5 list-inside list-decimal pl-0 last:mb-0">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </ol>
    ),
    li: ({ children }) => (
      <li className="mb-0.5 pl-0 [&>p]:mb-0">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </strong>
    ),
    em: ({ children }) => (
      <em className="italic">{injectCitations(children, options.sources, options.onOpenCitationInSheet)}</em>
    ),
    hr: () => <hr className="my-3 border-border" />,
    table: ({ children }) => (
      <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[280px] border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border px-3 py-2 font-medium">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border/80 px-3 py-2 align-top">
        {injectCitations(children, options.sources, options.onOpenCitationInSheet)}
      </td>
    ),
    code: ({ className, children, ...rest }) => {
      const isBlock = /language-/.test(className ?? "");
      if (isBlock)
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      return (
        <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.9em] text-foreground" {...rest}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(children)) {
        const lang = languageFromClassName(children.props.className);
        const text = reactNodeToPlainText(children.props.children).replace(/\n$/, "");
        if (!text.trim()) return null;
        return <FencedCodeBlock lang={lang} text={text} />;
      }
      const text = reactNodeToPlainText(children).replace(/\n$/, "");
      if (!text.trim()) return null;
      return <FencedCodeBlock lang={null} text={text} />;
    },
  };
}

/** Default components without web-search citation rewriting. */
export const ASSISTANT_MD_COMPONENTS: Components = createAssistantMdComponents();
