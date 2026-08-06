import * as React from "react";
import type { Components } from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import type { ChatMessageAttachment, WebSearchSource } from "@agenticx/core-api";
import { FencedCodeBlock } from "./FencedCodeBlock";
import { WebSearchCitation } from "../components/molecules/WebSearchCitation";
import {
  resolveCitationSource,
  splitCitationText,
} from "../utils/web-search-citation";
import { splitTextByAttachmentNames } from "../utils/attachment-link";

export const ARTIFACT_HREF_PREFIX = "artifact:";

/**
 * react-markdown's defaultUrlTransform only allows http(s)/mailto/… and strips
 * unknown schemes to "". That turns `[终稿](artifact:<id>)` into `<a href="">`
 * with target=_blank, which opens the current route (e.g. /workspace) in a new tab.
 * Keep the default sanitizer, but whitelist our deep-research artifact protocol.
 */
export function assistantUrlTransform(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith(ARTIFACT_HREF_PREFIX)) {
    return trimmed;
  }
  return defaultUrlTransform(value);
}

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
          // Key intentionally excludes keyPrefix: streaming reshapes the markdown AST,
          // so a path-derived key remounted every chip on each token and made the
          // favicons flash / appear to jump.
          <WebSearchCitation
            key={`cite-${part.index1Based}-${i}`}
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

function injectAttachmentLinks(
  children: React.ReactNode,
  attachments: ChatMessageAttachment[] | undefined,
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void,
): React.ReactNode {
  if (!attachments?.length || !onOpenAttachment) return children;

  const mapNode = (node: React.ReactNode, keyPrefix: string): React.ReactNode => {
    if (node == null || typeof node === "boolean") return node;
    if (typeof node === "number") return node;
    if (typeof node === "string") {
      const parts = splitTextByAttachmentNames(node, attachments);
      if (parts.length === 1 && parts[0]?.type === "text") return node;
      return parts.map((part, i) => {
        if (part.type === "text") {
          return <React.Fragment key={`${keyPrefix}-at-${i}`}>{part.value}</React.Fragment>;
        }
        return (
          <button
            key={`${keyPrefix}-af-${i}-${part.attachment.name}`}
            type="button"
            className="inline cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpenAttachment(part.attachment);
            }}
          >
            {part.value}
          </button>
        );
      });
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => mapNode(child, `${keyPrefix}-${i}`));
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
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

  return mapNode(children, "attach");
}

type AssistantMdOptions = {
  sources?: WebSearchSource[];
  onOpenCitationInSheet?: (index1Based: number) => void;
  sessionAttachments?: ChatMessageAttachment[];
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void;
  /** Deep-research deliverable: open docked files pane on this artifact id. */
  onOpenArtifact?: (artifactId: string) => void;
  /** document: roomier report preview typography + list-outside numbering */
  variant?: "chat" | "document";
};

export function createAssistantMdComponents(options: AssistantMdOptions = {}): Components {
  const doc = options.variant === "document";
  const enrich = (children: React.ReactNode) =>
    injectCitations(
      injectAttachmentLinks(children, options.sessionAttachments, options.onOpenAttachment),
      options.sources,
      options.onOpenCitationInSheet,
    );
  const cite = enrich;

  const wrap =
    (Tag: "h1" | "h2" | "h3" | "p", className: string) =>
    ({ children }: { children?: React.ReactNode }) => {
      return React.createElement(Tag, { className }, cite(children));
    };

  return {
    h1: wrap(
      "h1",
      doc
        ? "mb-4 mt-0 text-balance text-2xl font-semibold tracking-tight first:mt-0"
        : "mb-2 mt-3 text-balance pl-0 text-xl font-semibold first:mt-0",
    ),
    h2: wrap(
      "h2",
      doc
        ? "mb-3 mt-6 text-balance text-lg font-semibold tracking-tight first:mt-0"
        : "mb-1.5 mt-3 text-balance pl-0 text-lg font-semibold first:mt-0",
    ),
    h3: wrap(
      "h3",
      doc
        ? "mb-2 mt-5 text-balance text-base font-semibold first:mt-0"
        : "mb-1.5 mt-2 text-balance pl-0 text-base font-semibold first:mt-0",
    ),
    p: wrap("p", doc ? "mb-3.5 text-[15px] leading-7 last:mb-0" : "mb-2.5 pl-0 last:mb-0"),
    ul: ({ children }) => (
      <ul
        className={
          doc
            ? "mb-3.5 list-outside list-disc space-y-2 pl-6 text-[15px] leading-7 last:mb-0"
            : "mb-2.5 list-inside list-disc pl-0 last:mb-0"
        }
      >
        {cite(children)}
      </ul>
    ),
    ol: ({ children }) => (
      <ol
        className={
          doc
            ? "mb-3.5 list-outside list-decimal space-y-2.5 pl-6 text-[15px] leading-7 marker:font-medium marker:text-muted-foreground last:mb-0"
            : "mb-2.5 list-inside list-decimal pl-0 last:mb-0"
        }
      >
        {cite(children)}
      </ol>
    ),
    li: ({ children }) => (
      <li className={doc ? "pl-1 [&>p]:mb-2 [&>p:last-child]:mb-0" : "mb-0.5 pl-0 [&>p]:mb-0"}>
        {cite(children)}
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={
          doc
            ? "my-4 border-l-[3px] border-primary/40 pl-4 text-[15px] leading-7 text-muted-foreground"
            : "my-2 border-l-2 border-border pl-3 text-muted-foreground"
        }
      >
        {cite(children)}
      </blockquote>
    ),
    a: ({ children, href }) => {
      if (href?.toLowerCase().startsWith(ARTIFACT_HREF_PREFIX)) {
        const artifactId = href.slice(ARTIFACT_HREF_PREFIX.length).trim();
        if (artifactId) {
          return (
            <button
              type="button"
              className="inline cursor-pointer font-medium text-primary underline underline-offset-2 hover:opacity-90"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                options.onOpenArtifact?.(artifactId);
              }}
            >
              {children}
            </button>
          );
        }
      }
      // Empty href after url sanitization must not open a blank/current-route tab.
      if (!href) {
        return <span className="font-medium text-primary">{children}</span>;
      }
      return (
        <a
          href={href}
          className="text-primary underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {children}
        </a>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{cite(children)}</strong>
    ),
    em: ({ children }) => <em className="italic">{cite(children)}</em>,
    hr: () => <hr className={doc ? "my-6 border-border/80" : "my-3 border-border"} />,
    table: ({ children }) => (
      <div className={doc ? "my-4 max-w-full overflow-x-auto rounded-lg border border-border" : "my-2 max-w-full overflow-x-auto rounded-md border border-border"}>
        <table className="w-full min-w-[280px] border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border px-3 py-2 font-medium">{cite(children)}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border/80 px-3 py-2 align-top">{cite(children)}</td>
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
