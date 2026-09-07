/** Deep-research interaction preference (clarify entry), localStorage-backed. */

import { getChatCopy, type PortalLocale } from "../i18n/chat-copy";

export type DeepResearchInteractionPref =
  | "auto"
  | "direct"
  | "card_first"
  | "plan_chat";

export const DEEP_RESEARCH_INTERACTION_STORAGE_KEY = "agx-deep-research-interaction-pref-v1";

export const DEEP_RESEARCH_INTERACTION_OPTION_IDS = [
  "auto",
  "direct",
  "card_first",
  "plan_chat",
] as const;

const VALID: ReadonlySet<string> = new Set(DEEP_RESEARCH_INTERACTION_OPTION_IDS);

/** Legacy values persisted before「计划对齐」合并，读出时迁移为 plan_chat. */
const LEGACY_TO_PLAN_CHAT = new Set(["chat_first", "plan_first"]);

export function normalizeDeepResearchInteractionPref(
  raw: unknown,
): DeepResearchInteractionPref {
  if (typeof raw !== "string") return "auto";
  if (LEGACY_TO_PLAN_CHAT.has(raw)) return "plan_chat";
  return VALID.has(raw) ? (raw as DeepResearchInteractionPref) : "auto";
}

/** Read the persisted preference; "auto" means the server-side policy decides. */
export function getDeepResearchInteractionPref(): DeepResearchInteractionPref {
  try {
    const raw = globalThis.localStorage?.getItem(DEEP_RESEARCH_INTERACTION_STORAGE_KEY);
    const pref = normalizeDeepResearchInteractionPref(raw);
    // Rewrite legacy keys so subsequent reads stay on the new id.
    if (typeof raw === "string" && LEGACY_TO_PLAN_CHAT.has(raw) && pref === "plan_chat") {
      setDeepResearchInteractionPref("plan_chat");
    }
    return pref;
  } catch {
    return "auto";
  }
}

export function setDeepResearchInteractionPref(pref: DeepResearchInteractionPref): void {
  try {
    globalThis.localStorage?.setItem(DEEP_RESEARCH_INTERACTION_STORAGE_KEY, pref);
  } catch {
    // ignore
  }
}

/** Short label for the chip tag (survives session switches via localStorage). */
export function labelForDeepResearchInteractionPref(
  pref: DeepResearchInteractionPref,
  locale: PortalLocale = "zh",
): string {
  const copy = getChatCopy(locale);
  const map = {
    auto: copy.interaction.auto,
    direct: copy.interaction.direct,
    card_first: copy.interaction.cardFirst,
    plan_chat: copy.interaction.planChat,
  };
  return map[pref] ?? map.auto;
}
