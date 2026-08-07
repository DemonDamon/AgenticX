/** Deep-research interaction preference (clarify entry), localStorage-backed. */

export type DeepResearchInteractionPref =
  | "auto"
  | "direct"
  | "card_first"
  | "plan_chat";

export const DEEP_RESEARCH_INTERACTION_STORAGE_KEY = "agx-deep-research-interaction-pref-v1";

const VALID: ReadonlySet<string> = new Set([
  "auto",
  "direct",
  "card_first",
  "plan_chat",
]);

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

/** Label + hint for the preference popover (中文界面). */
export const DEEP_RESEARCH_INTERACTION_OPTIONS: Array<{
  id: DeepResearchInteractionPref;
  label: string;
  hint: string;
}> = [
  { id: "auto", label: "自动", hint: "由系统判断是否需要问我" },
  { id: "direct", label: "直接开始", hint: "能合理假设时不要等我确认" },
  { id: "card_first", label: "卡片确认", hint: "开始前用选项卡确认关键方向" },
  {
    id: "plan_chat",
    label: "计划对齐",
    hint: "先看计划，可多轮对话修改再开跑",
  },
];

/** Short label for the chip tag (survives session switches via localStorage). */
export function labelForDeepResearchInteractionPref(
  pref: DeepResearchInteractionPref,
): string {
  return (
    DEEP_RESEARCH_INTERACTION_OPTIONS.find((opt) => opt.id === pref)?.label ?? "自动"
  );
}
