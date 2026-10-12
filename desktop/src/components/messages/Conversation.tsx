/**
 * Group-chat thread primitives: 80% bubble column, 18px surface, data-slot hooks.
 * Author: Damon Li
 */
import type { ComponentProps, CSSProperties, ReactNode } from "react";

type DivProps = {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Conversation({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="conversation"
      className={`flex min-w-0 flex-col gap-2 ${className}`.trim()}
      {...props}
    />
  );
}

export function ConversationBubble({
  align = "start",
  className = "",
  ...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="conversation-bubble"
      data-align={align}
      className={`relative flex w-fit min-w-0 max-w-[var(--agx-conversation-bubble-max)] flex-col gap-1 ${
        align === "end" ? "self-end" : "self-start"
      } ${className}`.trim()}
      {...props}
    />
  );
}

export function ConversationContent({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="conversation-content"
      className={`relative w-fit max-w-full min-w-0 ${className}`.trim()}
      {...props}
    />
  );
}

export function MaybeConversationBubble({
  active,
  align,
  className,
  style,
  children,
}: DivProps & { active: boolean; align: "start" | "end" }) {
  if (!active) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <ConversationBubble align={align} className={className} style={style}>
      {children}
    </ConversationBubble>
  );
}

export function MaybeConversationContent({
  active,
  className,
  style,
  children,
}: DivProps & { active: boolean }) {
  if (!active) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <ConversationContent className={className} style={style}>
      {children}
    </ConversationContent>
  );
}
