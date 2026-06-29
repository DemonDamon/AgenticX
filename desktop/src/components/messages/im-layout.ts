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
 * `12 + 10 = 22px` (icon-center column) for the IM body font (--agx-chat-im-body-font-size).
 */
const ASSISTANT_TEXT_PADDING_LEFT_PX = 2.5;

/**
 * px from the ImBubble container's left edge to the first action icon /
 * follow-up chip. The action row is a sibling of the bubble (NOT inside the
 * bubble's padding), so the absolute offset is the icon-center column itself.
 */
const ASSISTANT_ACTION_MARGIN_LEFT_PX = 12;

/** 20×20 icon column — centers on timeline at bubble px-3 (12px) + 10px = 22px. */
export const ASSISTANT_ICON_RAIL_CLASS =
  "flex h-[20px] w-[20px] shrink-0 items-center justify-center";

/** Theme-primary rail color — shared by thought chain, tool rail, and system status rows. */
export const REACT_RAIL_ICON_CLASS =
  "text-[rgb(var(--theme-color-rgb,59,130,246))]";

export const REACT_RAIL_ICON_TILE_STYLE: CSSProperties = {
  backgroundColor: "rgba(var(--theme-color-rgb, 59, 130, 246), 0.12)",
  boxShadow: "inset 0 0 0 1px rgba(var(--theme-color-rgb, 59, 130, 246), 0.32)",
  color: "rgb(var(--theme-color-rgb, 59, 130, 246))",
};

export function getAssistantTextClassName(options: AssistantTextClassOptions = {}): string | undefined {
  if (!options.hasReasoning) return undefined;
  return options.inReActRow ? "mt-1" : "mt-2";
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
