import type { ReactNode } from "react";
import "./empty-chat-pane.css";

/** Keep the existing empty-chat presentation, prioritizing its composer when short. */
export function EmptyChatPane({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full min-h-0" style={{ containerType: "size", containerName: "chat-empty" }}>
      <div className="agx-empty-chat-content relative flex h-full flex-col items-center justify-start gap-8 overflow-y-auto px-4 pb-10 pt-11 md:gap-10 md:pb-16">
        <div className="agx-empty-chat-hero shrink-0">{hero}</div>
        <div className="agx-empty-chat-composer w-full max-w-[46rem] shrink-0">{children}</div>
      </div>
    </div>
  );
}
