"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes("language-")) || String(children).includes("\n");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[11px]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-2 last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-2 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 className="mb-2 text-sm font-semibold last:mb-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold last:mb-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 text-xs font-semibold last:mb-0">{children}</h3>,
  hr: () => <hr className="my-2 border-border" />,
};

export function ConversationMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text.trim()) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className={className ?? "text-[12px] leading-relaxed break-words"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
