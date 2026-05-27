import type { Message } from "../../store";
import type { ReactNode } from "react";
import { CitationMarkdownBody } from "./CitationMarkdownBody";
import { ReferencesCard } from "./ReferencesCard";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function AssistantBubble({ message, badge }: Props) {
  const isStreaming = message.id === "__stream__";
  return (
    <div className="mr-8 min-w-0 overflow-hidden rounded-xl rounded-tl-sm border border-border bg-surface-bubble px-3 py-2 text-[15px] leading-relaxed">
      {(message.references?.length ?? 0) > 0 ? (
        <ReferencesCard references={message.references ?? []} searchedQueries={message.searchedQueries} />
      ) : null}
      {badge}
      <CitationMarkdownBody content={message.content} references={message.references} isStreaming={isStreaming} />
    </div>
  );
}
