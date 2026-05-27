import { Fragment, useMemo, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
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
import { normalizeCitationMarkers, splitCitationSegments } from "./citation-normalize";

type Props = {
  content: string;
  references?: SearchReference[];
  isStreaming?: boolean;
  onQuoteText?: (text: string) => void;
  className?: string;
  style?: CSSProperties;
};

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

  const normalized = normalizeCitationMarkers(content, (references?.length ?? 0) > 0);
  const hasReferences = (references?.length ?? 0) > 0;
  const segments = hasReferences ? splitCitationSegments(normalized) : [{ kind: "text" as const, value: normalized }];

  return (
    <div className={className} style={style}>
      <MarkdownContext.Provider value={{ isStreaming, onQuoteText, references }}>
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
                components={chatMarkdownComponents}
                urlTransform={chatUrlTransform}
              >
                {normalizeChatMarkdownContent(segment.value, { isStreaming })}
              </ReactMarkdown>
            </Fragment>
          );
        })}
      </MarkdownContext.Provider>
    </div>
  );
}
