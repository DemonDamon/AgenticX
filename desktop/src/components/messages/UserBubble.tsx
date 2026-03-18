import type { Message } from "../../store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  message: Message;
};

export function UserBubble({ message }: Props) {
  return (
    <div className="ml-8 min-w-0 overflow-hidden rounded-xl rounded-tr-sm border border-border bg-surface-bubbleUser px-3 py-2 text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
    </div>
  );
}
