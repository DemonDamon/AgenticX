import type { Message } from "../../store";
import { renderUserMessageInlineBody } from "./user-message-inline";

type Props = {
  message: Message;
};

export function UserBubble({ message }: Props) {
  const referenceAttachments = (message.attachments ?? []).filter((a) => !!a.referenceToken);
  return (
    <div className="ml-8 min-w-0 overflow-hidden rounded-xl rounded-tr-sm border border-border bg-surface-bubbleUser px-3 py-2 text-[16px] leading-relaxed">
      <div className="break-words">{renderUserMessageInlineBody(message.content, referenceAttachments)}</div>
    </div>
  );
}
