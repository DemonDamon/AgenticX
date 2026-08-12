import type { Message } from "../../store";
import { renderUserMessageInlineBody } from "./user-message-inline";
import { isWorkspaceReferenceAttachment } from "../../utils/reference-attachment";

type Props = {
  message: Message;
};

export function UserBubble({ message }: Props) {
  const referenceAttachments = (message.attachments ?? []).filter((a) => isWorkspaceReferenceAttachment(a));
  return (
    <div
      className="agx-im-user-bubble ml-8 min-w-0 overflow-hidden rounded-xl rounded-tr-sm border-0 px-3.5 py-2.5 text-[15px] leading-relaxed"
      style={{
        background: "var(--chat-im-user-bg)",
        color: "var(--chat-im-user-text)",
      }}
    >
      <div className="break-words">{renderUserMessageInlineBody(message.content, referenceAttachments)}</div>
    </div>
  );
}
