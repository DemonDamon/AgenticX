import * as React from "react";
import type { Components } from "react-markdown";
import { FencedCodeBlock } from "./FencedCodeBlock";

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

export const ASSISTANT_MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-balance pl-0 text-xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-balance pl-0 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-balance pl-0 text-base font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2.5 pl-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2.5 list-inside list-disc pl-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2.5 list-inside list-decimal pl-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5 pl-0 [&>p]:mb-0">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[280px] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/80 px-3 py-2 align-top">{children}</td>,
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) return <code className={className} {...rest}>{children}</code>;
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
