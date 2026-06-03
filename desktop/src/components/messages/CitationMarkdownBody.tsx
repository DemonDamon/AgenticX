import { Fragment, useMemo, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { SearchReference } from "../../types/search-references";
import { CitationBadge } from "./CitationBadge";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  MarkdownContext,
  normalizeChatMarkdownContent,
} from "./markdown-components";
import {
  normalizeCitationMarkers,
  relocateCitationMarkersForDisplay,
  splitCitationParagraphBlocks,
  splitCitationSegments,
  stripOrphanCitationMarkers,
} from "./citation-normalize";

type Props = {
  content: string;
  references?: SearchReference[];
  isStreaming?: boolean;
  onQuoteText?: (text: string) => void;
  className?: string;
  style?: CSSProperties;
};

/** Keep citation pills on the same line as preceding list items / sentences. */
const inlineCitationMarkdownComponents: Partial<Components> = {
  ...chatMarkdownComponents,
  p({ children }) {
    return <p className="m-0 inline contents">{children}</p>;
  },
  ol({ children, ...rest }) {
    return (
      <ol className="m-0 inline list-inside align-baseline pl-0" {...rest}>
        {children}
      </ol>
    );
  },
  ul({ children, ...rest }) {
    return (
      <ul className="m-0 inline list-inside align-baseline pl-0" {...rest}>
        {children}
      </ul>
    );
  },
};

function InlineCitationRow({
  block,
  refMap,
  isStreaming,
}: {
  block: string;
  refMap: Map<number, SearchReference>;
  isStreaming?: boolean;
}) {
  const segments = splitCitationSegments(block);
  return (
    <span className="inline max-w-full align-baseline leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.kind === "citation") {
          const id = Number(segment.value);
          return (
            <CitationBadge
              key={`cite-${index}-${id}`}
              id={id}
              reference={refMap.get(id)}
            />
          );
        }
        if (!segment.value) return null;
        return (
          <Fragment key={`md-${index}`}>
            <ReactMarkdown
              remarkPlugins={chatRemarkPlugins}
              rehypePlugins={chatRehypePlugins}
              components={inlineCitationMarkdownComponents}
              urlTransform={chatUrlTransform}
            >
              {normalizeChatMarkdownContent(segment.value, { isStreaming })}
            </ReactMarkdown>
          </Fragment>
        );
      })}
    </span>
  );
}

export function CitationMarkdownBody({
  content,
  references,
  isStreaming,
  onQuoteText,
  className,
  style,
}: Props) {
  const refMap = useMemo(() => {
    const map = new Map<number, SearchReference>();
    for (const ref of references ?? []) map.set(ref.id, ref);
    return map;
  }, [references]);

  const hasReferences = (references?.length ?? 0) > 0;
  const normalized = normalizeCitationMarkers(content, hasReferences);
  const withCitationLayout = hasReferences
    ? relocateCitationMarkersForDisplay(normalized)
    : normalized;
  const displayText =
    hasReferences || isStreaming
      ? withCitationLayout
      : stripOrphanCitationMarkers(withCitationLayout);
  const blocks = hasReferences
    ? splitCitationParagraphBlocks(withCitationLayout)
    : [displayText];

  return (
    <div className={className} style={style}>
      <MarkdownContext.Provider value={{ isStreaming, onQuoteText, references }}>
        {blocks.map((block, blockIndex) => (
          <div key={`cite-block-${blockIndex}`} className={blockIndex < blocks.length - 1 ? "mb-2" : undefined}>
            {hasReferences ? (
              <InlineCitationRow block={block} refMap={refMap} isStreaming={isStreaming} />
            ) : (
              <ReactMarkdown
                remarkPlugins={chatRemarkPlugins}
                rehypePlugins={chatRehypePlugins}
                components={chatMarkdownComponents}
                urlTransform={chatUrlTransform}
              >
                {normalizeChatMarkdownContent(block, { isStreaming })}
              </ReactMarkdown>
            )}
          </div>
        ))}
      </MarkdownContext.Provider>
    </div>
  );
}
