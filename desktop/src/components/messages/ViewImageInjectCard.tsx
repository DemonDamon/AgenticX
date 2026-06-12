import { ImageIcon } from "lucide-react";
import type { Message } from "../../store";
import { AttachmentCard } from "./AttachmentCard";

type Props = {
  message: Message;
};

/** Runtime-injected vision payload from view_image — not a user-typed message. */
export function ViewImageInjectCard({ message }: Props) {
  const attachments = message.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  return (
    <div
      className={`flex min-w-0 gap-2 px-3 py-1 ${hasAttachments ? "items-start" : "items-center"}`}
    >
      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-violet-500/15 text-violet-400 ring-1 ring-violet-400/35">
          <ImageIcon className="h-3 w-3" strokeWidth={2.2} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-subtle">
          模型通过 <span className="text-text-strong">view_image</span> 加载的图片
        </p>
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <AttachmentCard key={`${attachment.name}-${index}`} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
