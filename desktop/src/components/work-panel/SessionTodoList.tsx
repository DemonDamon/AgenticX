/**
 * Session-level todo checklist for WorkPanel summary tab.
 * Trae Work style: completed = green circle+check (CircleCheck), no N/M badge row.
 *
 * Author: Damon Li
 */

import { Circle, CircleCheck, Loader2 } from "lucide-react";
import type { ParsedTodo } from "../TodoUpdateCard";

type Props = {
  todo: ParsedTodo;
};

/** Soft sage green matching Trae Work completed check (shared with StickyTaskBar). */
export const TRAE_TODO_CHECK_CLASS = "text-[#5B9A6F]";

export function SessionTodoList({ todo }: Props) {
  return (
    <ul className="space-y-0.5">
      {todo.items.map((item, idx) => (
        <li key={`${item.content}-${idx}`} className="flex items-start gap-2 rounded px-1 py-1">
          <span
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center"
            aria-hidden
          >
            {item.status === "completed" ? (
              <CircleCheck className={`h-4 w-4 ${TRAE_TODO_CHECK_CLASS}`} strokeWidth={1.75} />
            ) : item.status === "in_progress" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[rgb(var(--theme-color-fg-rgb,59,130,246))]" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.75} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={
                item.status === "completed"
                  ? "text-[12px] leading-snug text-text-primary"
                  : item.status === "in_progress"
                    ? "text-[12px] font-medium leading-snug text-text-strong"
                    : "text-[12px] leading-snug text-text-muted"
              }
            >
              {item.content}
            </div>
            {item.status === "in_progress" &&
            item.activeForm &&
            item.activeForm !== item.content ? (
              <div className="mt-0.5 text-[11px] text-[rgba(var(--theme-color-fg-rgb,59,130,246),0.8)]">
                {item.activeForm}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
