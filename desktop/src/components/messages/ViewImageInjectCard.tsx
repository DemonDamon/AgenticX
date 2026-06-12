import { ImageIcon } from "lucide-react";
import type { Message } from "../../store";
import { AttachmentCard } from "./AttachmentCard";

type Props = {
  message: Message;
};

/** Runtime-injected vision payload from view_image — not a user-typed message. */
export function ViewImageInjectCard({ message }: Props) {
  const attachments = message.attachments ?? [];
  return (
    <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-violet-500/15 text-violet-400 ring-1 ring-violet-400/35">
          <ImageIcon className="h-3 w-3" strokeWidth={2.2} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[1.65] text-text-muted">
          模型通过 <span className="font-medium text-text-strong">view_image</span> 加载的图片
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
