import type { Message } from "../../store";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  normalizeChatMarkdownContent,
} from "./markdown-components";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function AssistantBubble({ message, badge }: Props) {
  return (
    <div className="mr-8 min-w-0 overflow-hidden rounded-xl rounded-tl-sm border border-border bg-surface-bubble px-3 py-2 text-[14px] leading-relaxed">
      {badge}
      <ReactMarkdown
        remarkPlugins={chatRemarkPlugins}
        rehypePlugins={chatRehypePlugins}
        components={chatMarkdownComponents}
        urlTransform={chatUrlTransform}
      >
        {normalizeChatMarkdownContent(message.content)}
      </ReactMarkdown>
    </div>
  );
}
