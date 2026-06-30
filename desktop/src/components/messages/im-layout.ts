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

/**
 * Single source of truth for the ReAct rail header title (思考了 / 已调用工具 /
 * 已检索…). These three rows live in different containers — ReasoningBlock and
 * ReferencesCard render inside an ImBubble (`leading-relaxed`, 1.625) while the
 * tool-group card renders at the message-group level (`leading-normal`, 1.5).
 * Without an explicit line-height, the same 13px title computes to a different
 * line box per row (≈21px vs ≈19.5px), so rows read as different font sizes and
 * the vertical rhythm looks uneven. Pinning `leading-5` (20px) makes every rail
 * row exactly one 20px line box, matching the 20px icon column.
 */
export const REACT_RAIL_TITLE_CLASS =
  "text-[13px] font-medium leading-5 text-text-subtle";

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

/** Uniform vertical gap: body → icon row → follow-up chips (matches composer pt-2.5 rhythm). */
export const ASSISTANT_ACTION_RHYTHM_GAP_CLASS = "gap-2.5";

/**
 * Body + icon row + follow-up chips in one column — every step uses the same gap-2.5
 * (no separate mt on the action block, which skews body→icon vs icon→chip spacing).
 */
export const ASSISTANT_ACTION_RHYTHM_STACK_CLASS = `agx-assistant-action-rhythm flex min-w-0 flex-col ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS} mb-6 self-stretch`;

/** Icon row + optional follow-up chips below assistant body (inside rhythm stack). */
export const ASSISTANT_ACTION_BLOCK_CLASS = `flex min-w-0 flex-col ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS} self-stretch`;

/** Block-level copy/quote row (fixed height so gaps measure consistently). */
export const ASSISTANT_ACTION_ICON_ROW_CLASS =
  "agx-assistant-action-icons group flex h-5 w-fit max-w-full flex-wrap items-center gap-0.5 text-text-faint";

/**
 * ReAct block tail: last body row + icon row + follow-up chips share one flex column
 * with uniform gap-2.5 — never stack separate mt-* on children (line-height slack on the
 * body row would otherwise make body→icons look larger than icons→chips).
 */
export const ASSISTANT_ACTION_RHYTHM_END_CLASS = `agx-assistant-action-rhythm-end flex min-w-0 flex-col ${ASSISTANT_ACTION_RHYTHM_GAP_CLASS} self-stretch`;

/** @deprecated Prefer ASSISTANT_ACTION_RHYTHM_END_CLASS; kept for grep/back-compat. */
export const ASSISTANT_ACTION_TAIL_CLASS = ASSISTANT_ACTION_RHYTHM_END_CLASS;

/** Last assistant body before peeled action row — tightens trailing line-box slack. */
export const ASSISTANT_BODY_TAIL_CLASS = "agx-assistant-body-tail";

/** Icon row only (no follow-up chips in the same rhythm stack). */
export const ASSISTANT_ACTION_ICON_ONLY_CLASS = "mb-6 mt-2.5 min-w-0 self-stretch";

/** Stack of follow-up chips — chip-to-chip spacing only (icon→first chip uses parent gap). */
export const ASSISTANT_FOLLOWUP_LIST_CLASS =
  "flex min-w-0 flex-col items-start gap-2.5 self-stretch";

/** Elevated pill for suggested follow-up questions — solid fill vs page bg (Doubao-like). */
export const ASSISTANT_FOLLOWUP_CHIP_CLASS =
  "agx-followup-chip group flex max-w-full w-fit items-center gap-1.5 rounded-xl border px-4 py-2.5 text-left text-[13px] leading-snug text-text-subtle transition-colors duration-150 hover:text-text-primary whitespace-normal";
