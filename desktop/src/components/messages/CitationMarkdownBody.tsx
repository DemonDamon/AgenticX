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
  buildCitationRenderGroups,
  escapeMarkdownOrderedListMarkers,
  normalizeCitationMarkers,
  relocateCitationMarkersForDisplay,
  splitCitationParagraphBlocks,
  splitCitationSegments,
  stripOrphanCitationMarkers,
  type CitationSegment,
} from "./citation-normalize";

type Props = {
  content: string;
  references?: SearchReference[];
  isStreaming?: boolean;
  onQuoteText?: (text: string) => void;
  className?: string;
  style?: CSSProperties;
};

/** Headings must stay inline so a trailing [N] segment is not forced onto the next line. */
function inlineCitationHeading(className: string) {
  return function InlineHeading({ children }: { children?: React.ReactNode }) {
    return (
      <span className={`m-0 inline align-baseline font-semibold text-text-strong ${className}`}>
        {children}
      </span>
    );
  };
}

/** Keep citation pills on the same line as preceding list items / sentences. */
const inlineCitationMarkdownComponents: Partial<Components> = {
  ...chatMarkdownComponents,
  h1: inlineCitationHeading("text-xl"),
  h2: inlineCitationHeading("text-lg"),
  h3: inlineCitationHeading("text-[16px] leading-6"),
  h4: inlineCitationHeading("text-[15px] leading-6"),
  h5: inlineCitationHeading("text-sm"),
  h6: inlineCitationHeading("text-sm"),
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
  li({ children }) {
    return <span className="inline align-baseline">{children}</span>;
  },
};

function InlineCitationGroup({
  segments,
  refMap,
  isStreaming,
  groupIndex,
  blockLayout,
}: {
  segments: CitationSegment[];
  refMap: Map<number, SearchReference>;
  isStreaming?: boolean;
  groupIndex: number;
  /** Body groups after heading+cite must start on a new line. */
  blockLayout?: boolean;
}) {
  const Wrapper = blockLayout ? "div" : "span";
  return (
    <Wrapper
      className={
        blockLayout
          ? "block w-full max-w-full leading-relaxed"
          : "inline max-w-full align-baseline leading-relaxed"
      }
    >
      {segments.map((segment, index) => {
        if (segment.kind === "citation") {
          const id = Number(segment.value);
          return (
            <CitationBadge
              key={`cite-g${groupIndex}-${index}-${id}`}
              id={id}
              reference={refMap.get(id)}
            />
          );
        }
        if (!segment.value) return null;
        const mdSource = escapeMarkdownOrderedListMarkers(segment.value);
        const mdComponents = blockLayout ? chatMarkdownComponents : inlineCitationMarkdownComponents;
        return (
          <Fragment key={`md-g${groupIndex}-${index}`}>
            <ReactMarkdown
              remarkPlugins={chatRemarkPlugins}
              rehypePlugins={chatRehypePlugins}
              components={mdComponents}
              urlTransform={chatUrlTransform}
            >
              {normalizeChatMarkdownContent(mdSource, { isStreaming })}
            </ReactMarkdown>
          </Fragment>
        );
      })}
    </Wrapper>
  );
}

function InlineCitationRow({
  block,
  refMap,
  isStreaming,
}: {
  block: string;
  refMap: Map<number, SearchReference>;
  isStreaming?: boolean;
}) {
  const groups = buildCitationRenderGroups(splitCitationSegments(block));
  return (
    <div className="max-w-full leading-relaxed">
      {groups.map((segments, groupIndex) => (
        <InlineCitationGroup
          key={`cite-group-${groupIndex}`}
          segments={segments}
          refMap={refMap}
          isStreaming={isStreaming}
          groupIndex={groupIndex}
          blockLayout={groupIndex > 0}
        />
      ))}
    </div>
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
