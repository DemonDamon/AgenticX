import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { isThinkingPlaceholderText } from "./stream-overlay-policy";

const SKIP_SENTINEL = "__SKIP__";
const TRAILING_FINAL_RE = /(?:(?:\s+|(?<=[。．.！!？?]))(?:\*\*)?FINAL(?:\*\*)?\.?)+$/i;

export function stripTrailingFinalMarker(text: string): string {
  const raw = String(text ?? "");
  if (/^(?:\*\*)?FINAL(?:\*\*)?$/i.test(raw.trim())) return "";
  return raw.replace(TRAILING_FINAL_RE, "").replace(/\s+$/u, "");
}

export function isGroupStreamMessageId(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith("__group_stream__:");
}

/** Hide skip sentinels and in-progress think so the live bubble only shows body. */
export function visibleGroupStreamBody(raw: string): string {
  const parsed = parseReasoningContent(raw);
  const body = String(parsed.response ?? "").trim();
  if (!body || isThinkingPlaceholderText(body)) return "";
  if (SKIP_SENTINEL.startsWith(body) || body === SKIP_SENTINEL) return "";
  if (body.startsWith(SKIP_SENTINEL)) {
    return stripTrailingFinalMarker(body.slice(SKIP_SENTINEL.length).trim());
  }
  return stripTrailingFinalMarker(body);
}

export function shouldResetGroupStreamOnProgress(toolPhase: string): boolean {
  return toolPhase === "calling";
}
