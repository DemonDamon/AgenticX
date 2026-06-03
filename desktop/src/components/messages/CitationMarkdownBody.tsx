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
import {
  normalizeCitationMarkers,
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
  // 已完成（非流式）且本轮无 references 时，剥离模型编造的游离角标，避免展示假溯源。
  // 流式阶段不剥离——references 可能稍后才随 tool_result 到达，避免角标闪烁。
  const displayText = hasReferences || isStreaming ? normalized : stripOrphanCitationMarkers(normalized);
  const segments = hasReferences ? splitCitationSegments(normalized) : [{ kind: "text" as const, value: displayText }];

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
