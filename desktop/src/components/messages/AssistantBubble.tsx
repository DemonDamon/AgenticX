import type { Message } from "../../store";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatMarkdownComponents } from "./markdown-components";

type Props = {
  message: Message;
  badge?: ReactNode;
};

export function AssistantBubble({ message, badge }: Props) {
  return (
    <div className="mr-8 min-w-0 overflow-hidden rounded-xl rounded-tl-sm border border-border bg-surface-bubble px-3 py-2 text-sm">
      {badge}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
        {message.content}
      </ReactMarkdown>
    </div>
  );
}
