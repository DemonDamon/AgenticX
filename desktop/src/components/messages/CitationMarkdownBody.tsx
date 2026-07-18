import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { isValidElement } from "react";
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
  mergeAdjacentCitations,
  normalizeCitationMarkers,
  relocateCitationMarkersForDisplay,
  containsGfmTable,
  splitCitationParagraphBlocks,
  splitCitationSegments,
  splitCitationSegmentsRespectingTables,
  stripOrphanCitationMarkers,
  type CitationRenderItem,
  type CitationSegment,
} from "./citation-normalize";
import { buildDocNumberMap } from "../../utils/citation-doc-grouping";
import { extractSourceAttribution } from "./source-attribution-parse";

type Props = {
  content: string;
  references?: SearchReference[];
  isStreaming?: boolean;
  onQuoteText?: (text: string) => void;
  onRevealPath?: (path: string) => void;
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

const HTML_BR_IN_TEXT_RE = /<br\s*\/?>/gi;

function reactNodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join("");
  if (isValidElement(node)) return reactNodeToPlainText(node.props.children);
  return "";
}

function renderTextWithBreaks(text: string, keyPrefix: string): ReactNode {
  if (!HTML_BR_IN_TEXT_RE.test(text)) return text;
  const segments = text.split(HTML_BR_IN_TEXT_RE);
  return segments.map((segment, index) => (
    <Fragment key={`${keyPrefix}-br-${index}`}>
      {index > 0 ? <br /> : null}
      {segment}
    </Fragment>
  ));
}

function renderTableCellCitationContent(
  children: ReactNode,
  refMap: Map<number, SearchReference>,
  docNumberById: Map<number, number>,
): ReactNode {
  const flat = reactNodeToPlainText(children);
  if (!CITATION_IN_CELL_RE.test(flat)) {
    if (HTML_BR_IN_TEXT_RE.test(flat)) {
      return renderTextWithBreaks(flat, "cell");
    }
    return children;
  }
  const items: CitationRenderItem[] = mergeAdjacentCitations(
    splitCitationSegments(flat),
    docNumberById,
  );
  return items.map((item, index) => {
    if (item.kind === "citation") {
      const refs = item.ids
        .map((id) => refMap.get(id))
        .filter((r): r is SearchReference => Boolean(r));
      return (
        <CitationBadge
          key={`cell-cite-${index}-${item.docNumber}`}
          docNumber={item.docNumber}
          references={refs}
        />
      );
    }
    if (!item.value) return null;
    return (
      <Fragment key={`cell-txt-${index}`}>{renderTextWithBreaks(item.value, `cell-t-${index}`)}</Fragment>
    );
  });
}

const CITATION_IN_CELL_RE = /\[\d+\]/;

function makeCitationTableMarkdownComponents(
  refMap: Map<number, SearchReference>,
  docNumberById: Map<number, number>,
): Partial<Components> {
  const cell = (children: ReactNode) =>
    renderTableCellCitationContent(children, refMap, docNumberById);
  return {
    ...chatMarkdownComponents,
    td({ children, ...rest }) {
      return <td {...rest}>{cell(children)}</td>;
    },
    th({ children, ...rest }) {
      return <th {...rest}>{cell(children)}</th>;
    },
  };
}

function InlineCitationGroup({
  segments,
  refMap,
  docNumberById,
  isStreaming,
  groupIndex,
  blockLayout,
}: {
  segments: CitationSegment[];
  refMap: Map<number, SearchReference>;
  docNumberById: Map<number, number>;
  isStreaming?: boolean;
  groupIndex: number;
  /** Body groups after heading+cite must start on a new line. */
  blockLayout?: boolean;
}) {
  const hasTableSegment = segments.some((s) => s.kind === "text" && containsGfmTable(s.value));
  const useBlockWrapper = blockLayout || hasTableSegment;
  const Wrapper = useBlockWrapper ? "div" : "span";
  const items = mergeAdjacentCitations(segments, docNumberById);
  return (
    <Wrapper
      className={
        useBlockWrapper
          ? "block w-full max-w-full leading-relaxed"
          : "inline max-w-full align-baseline leading-relaxed"
      }
    >
      {items.map((item, index) => {
        if (item.kind === "citation") {
          const refs = item.ids
            .map((id) => refMap.get(id))
            .filter((r): r is SearchReference => Boolean(r));
          return (
            <CitationBadge
              key={`cite-g${groupIndex}-${index}-${item.docNumber}-${item.ids.join("_")}`}
              docNumber={item.docNumber}
              references={refs}
            />
          );
        }
        if (!item.value) return null;
        const mdSource = escapeMarkdownOrderedListMarkers(item.value);
        const isTableSegment = containsGfmTable(item.value);
        const mdComponents = isTableSegment
          ? makeCitationTableMarkdownComponents(refMap, docNumberById)
          : blockLayout
            ? chatMarkdownComponents
            : inlineCitationMarkdownComponents;
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
  docNumberById,
  isStreaming,
}: {
  block: string;
  refMap: Map<number, SearchReference>;
  docNumberById: Map<number, number>;
  isStreaming?: boolean;
}) {
  const groups = buildCitationRenderGroups(splitCitationSegmentsRespectingTables(block));
  return (
    <div className="max-w-full leading-relaxed">
      {groups.map((segments, groupIndex) => (
        <InlineCitationGroup
          key={`cite-group-${groupIndex}`}
          segments={segments}
          refMap={refMap}
          docNumberById={docNumberById}
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
  onRevealPath,
  className,
  style,
}: Props) {
  const refMap = useMemo(() => {
    const map = new Map<number, SearchReference>();
    for (const ref of references ?? []) map.set(ref.id, ref);
    return map;
  }, [references]);
  const docNumberById = useMemo(() => buildDocNumberMap(references ?? []), [references]);

  // Strip model-authored「数据来源标注」legends (epistemic theater, not real
  // provenance). Leaving them in-body makes `[N]` collide with citation pills.
  const { body: contentWithoutAttribution } = useMemo(
    () => extractSourceAttribution(content),
    [content],
  );

  const hasReferences = (references?.length ?? 0) > 0;
  const normalized = normalizeCitationMarkers(contentWithoutAttribution, hasReferences);
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
      <MarkdownContext.Provider value={{ isStreaming, onQuoteText, onRevealPath, references }}>
        {blocks.map((block, blockIndex) => (
          <div key={`cite-block-${blockIndex}`} className={blockIndex < blocks.length - 1 ? "mb-2" : undefined}>
            {hasReferences ? (
              <InlineCitationRow
                block={block}
                refMap={refMap}
                docNumberById={docNumberById}
                isStreaming={isStreaming}
              />
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
