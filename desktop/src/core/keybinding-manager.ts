export type KeybindingAction =
  | "open-command-palette"
  | "open-settings"
  | "clear-messages"
  | "toggle-mode"
  | "toggle-plan-mode"
  | "toggle-focus-mode"
  | "open-keybindings";
export type UserMode = "pro" | "lite";

type MatchRule = {
  action: KeybindingAction;
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  mode: UserMode | "both";
};

const RULES: MatchRule[] = [
  { action: "open-command-palette", key: "k", ctrlOrMeta: true, mode: "pro" },
  { action: "open-settings", key: ",", ctrlOrMeta: true, mode: "both" },
  { action: "clear-messages", key: "l", ctrlOrMeta: true, mode: "pro" },
  { action: "toggle-mode", key: "m", ctrlOrMeta: true, shift: true, mode: "both" },
  { action: "toggle-plan-mode", key: "p", ctrlOrMeta: true, shift: true, mode: "pro" },
  { action: "toggle-focus-mode", key: "f", ctrlOrMeta: true, shift: true, mode: "pro" },
  { action: "open-keybindings", key: "/", ctrlOrMeta: true, mode: "pro" },
];

export function matchKeybinding(event: KeyboardEvent, mode: UserMode): KeybindingAction | null {
  const key = event.key.toLowerCase();
  for (const rule of RULES) {
    if (rule.mode !== "both" && rule.mode !== mode) continue;
    if (key !== rule.key) continue;
    if (!!rule.ctrlOrMeta !== !!(event.ctrlKey || event.metaKey)) continue;
    if (!!rule.shift !== !!event.shiftKey) continue;
    return rule.action;
  }
  return null;
}
