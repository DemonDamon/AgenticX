/**
 * Shared identity rail for group confirm / clarification / tool-error cards.
 * Author: Damon Li
 */
import type { ReactNode } from "react";
import { ChatImAvatar } from "./ImBubble";

type Props = {
  name: string;
  avatarUrl?: string;
  avatarId?: string;
  children: ReactNode;
};

export function GroupSenderRail({ name, avatarUrl, avatarId, children }: Props) {
  return (
    <div className="agx-group-sender-rail flex min-w-0 w-full items-start gap-2 px-3">
      <div className="mt-[18px] shrink-0">
        <ChatImAvatar
          label={name}
          imageUrl={avatarUrl}
          avatarId={avatarId}
          variant="circle"
          size="sm"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <div className="mb-0.5 max-w-full truncate text-[12px] font-medium leading-4 text-text-faint">
          {name}
        </div>
        {children}
      </div>
    </div>
  );
}
