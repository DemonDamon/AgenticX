/**
 * Single source of truth for the assistant message "vertical rail".
 *
 * Goal: in any chat surface (Meta, group chat, automation, history replay),
 * the Thought icon, tool-call icon, assistant reply text, action buttons, and
 * follow-up chips must align on the SAME vertical line.
 *
 * The rail anchor is the icon-center column inside an ImBubble that already
 * has 12px (px-3) of horizontal padding. Tool-group cards and ReasoningBlock
 * both render a ~20px icon column inside that 12px padding, so the icon
 * center sits at `12 + 10 = 22px` from the bubble's outer left edge.
 *
 * We use inline styles (not Tailwind arbitrary values) so the offset works
 * even if the Tailwind JIT misses an arbitrary class on a fresh file.
 */
import type { CSSProperties } from "react";

type AssistantTextClassOptions = {
  hasReasoning?: boolean;
  inReActRow?: boolean;
};

type AssistantActionOffsetOptions = {
  inReActRow?: boolean;
};

/**
 * px from the assistant text wrapper's left to where the first character
 * should sit. The wrapper lives inside the ImBubble's `px-3` padding, so
 * `paddingLeft: 2.5` puts the first CJK character center close to
 * `12 + 10 = 22px` (icon-center column) for the 15px body font.
 */
const ASSISTANT_TEXT_PADDING_LEFT_PX = 2.5;

/**
 * px from the ImBubble container's left edge to the first action icon /
 * follow-up chip. The action row is a sibling of the bubble (NOT inside the
 * bubble's padding), so the absolute offset is the icon-center column itself.
 */
const ASSISTANT_ACTION_MARGIN_LEFT_PX = 12;

export function getAssistantTextClassName(options: AssistantTextClassOptions = {}): string | undefined {
  return options.hasReasoning ? "mt-2" : undefined;
}

export function getAssistantTextStyle(_options: AssistantTextClassOptions = {}): CSSProperties {
  return { paddingLeft: ASSISTANT_TEXT_PADDING_LEFT_PX };
}

export function getAssistantActionOffsetClass(_options: AssistantActionOffsetOptions = {}): string {
  return "";
}

export function getAssistantActionStyle(_options: AssistantActionOffsetOptions = {}): CSSProperties {
  return { marginLeft: ASSISTANT_ACTION_MARGIN_LEFT_PX };
}

export const ASSISTANT_TIMELINE_PX = {
  textPaddingLeft: ASSISTANT_TEXT_PADDING_LEFT_PX,
  actionMarginLeft: ASSISTANT_ACTION_MARGIN_LEFT_PX,
};
