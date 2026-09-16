import type { Message } from "../../store";
import type { ReactNode } from "react";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { ReferencesCard } from "./ReferencesCard";
import { withBibliographyFallback } from "./source-attribution-parse";

type Props = {
  message: Message;
  badge?: ReactNode;
  onRevealPath?: (path: string) => void;
};

export function AssistantBubble({ message, badge, onRevealPath }: Props) {
  const isStreaming = message.id === "__stream__";
  const displayRefs = withBibliographyFallback(message.references, message.content);
  return (
    <div className="mr-8 min-w-0 overflow-hidden rounded-xl rounded-tl-sm border border-border bg-surface-bubble px-3 py-2 text-[15px] leading-relaxed">
      {displayRefs.length > 0 ? (
        <ReferencesCard references={displayRefs} searchedQueries={message.searchedQueries} />
      ) : null}
      {badge}
      <CitationMarkdownBody content={message.content} references={displayRefs} isStreaming={isStreaming} onRevealPath={onRevealPath} />
    </div>
  );
}
