export type PttShortcutPreset = "ctrl+space" | "space-empty" | "alt+space" | "meta+space";

export type PttShortcut = {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  onlyWhenComposerEmpty: boolean;
};

export const PTT_SHORTCUT_STORAGE_KEY = "agx-voice-ptt-shortcut-v1";

export const DEFAULT_PTT_SHORTCUT_PRESET: PttShortcutPreset = "ctrl+space";

const PRESET_LABELS: Record<PttShortcutPreset, string> = {
  "ctrl+space": "Ctrl + Space",
  "space-empty": "Space（仅输入框为空时）",
  "alt+space": "Alt + Space",
  "meta+space": "⌘ / Win + Space",
};

export function presetToShortcut(preset: PttShortcutPreset): PttShortcut {
  switch (preset) {
    case "space-empty":
      return {
        code: "Space",
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        onlyWhenComposerEmpty: true,
      };
    case "alt+space":
      return {
        code: "Space",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        onlyWhenComposerEmpty: false,
      };
    case "meta+space":
      return {
        code: "Space",
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: true,
        onlyWhenComposerEmpty: false,
      };
    case "ctrl+space":
    default:
      return {
        code: "Space",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        onlyWhenComposerEmpty: false,
      };
  }
}

export function formatPttShortcutLabel(preset: PttShortcutPreset): string {
  return PRESET_LABELS[preset];
}

export function listPttShortcutPresets(): PttShortcutPreset[] {
  return ["ctrl+space", "space-empty", "alt+space", "meta+space"];
}

export function loadPttShortcutPreset(): PttShortcutPreset {
  try {
    const raw = localStorage.getItem(PTT_SHORTCUT_STORAGE_KEY);
    if (!raw) return DEFAULT_PTT_SHORTCUT_PRESET;
    const parsed = JSON.parse(raw) as { preset?: string };
    const preset = String(parsed?.preset ?? "") as PttShortcutPreset;
    if (listPttShortcutPresets().includes(preset)) return preset;
  } catch {
    /* ignore */
  }
  return DEFAULT_PTT_SHORTCUT_PRESET;
}

export function savePttShortcutPreset(preset: PttShortcutPreset): void {
  localStorage.setItem(PTT_SHORTCUT_STORAGE_KEY, JSON.stringify({ preset }));
}

export function loadPttShortcut(): PttShortcut {
  return presetToShortcut(loadPttShortcutPreset());
}

function modifierMatches(expected: boolean, actual: boolean): boolean {
  return !!expected === !!actual;
}

export function matchPttShortcut(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  shortcut: PttShortcut,
  composerEmpty: boolean
): boolean {
  if (shortcut.onlyWhenComposerEmpty && !composerEmpty) return false;
  if (event.code !== shortcut.code) return false;
  if (!modifierMatches(shortcut.ctrlKey, event.ctrlKey)) return false;
  if (!modifierMatches(shortcut.altKey, event.altKey)) return false;
  if (!modifierMatches(shortcut.shiftKey, event.shiftKey)) return false;
  if (!modifierMatches(shortcut.metaKey, event.metaKey)) return false;
  return true;
}

export function shouldStopPttOnKeyUp(
  event: Pick<KeyboardEvent, "code">,
  shortcut: PttShortcut,
  active: boolean
): boolean {
  if (!active) return false;
  return event.code === shortcut.code;
}
