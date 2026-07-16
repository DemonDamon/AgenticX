import type { ReactNode } from "react";

/**
 * Shared scrollable container for the main-area landing views
 * (avatar gallery / projects / automation). Keeps padding, background and
 * scroll behaviour consistent across the three landing views.
 */
export function MainViewShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-surface-base">
      <div className="mx-auto w-full max-w-[1160px] px-6 py-6">{children}</div>
    </div>
  );
}
