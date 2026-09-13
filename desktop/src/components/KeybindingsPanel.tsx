import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  mode: "pro" | "lite";
  onClose: () => void;
};

const PRO_ITEM_KEYS = [
  ["Ctrl/Cmd+K", "openGlobalSearch"],
  ["Ctrl+,", "openSettings"],
  ["Ctrl+L", "clearMessages"],
  ["Ctrl+Shift+P", "togglePlanMode"],
  ["Alt+↑ / Alt+↓", "historyNav"],
  ["Enter", "send"],
  ["Shift+Enter", "newline"],
  ["Escape", "closeOrStop"],
] as const;

const LITE_ITEM_KEYS = [
  ["Ctrl+,", "openSettings"],
  ["Enter", "send"],
  ["Shift+Enter", "newline"],
  ["Escape", "stopGeneration"],
] as const;

export function KeybindingsPanel({ open, mode, onClose }: Props) {
  const { t } = useTranslation("settings");
  if (!open) return null;
  const items = mode === "pro" ? PRO_ITEM_KEYS : LITE_ITEM_KEYS;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-surface-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-text-primary">
            {t("keybindings.title", { mode: mode.toUpperCase() })}
          </div>
          <button className="rounded px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover" onClick={onClose}>
            {t("shared.close")}
          </button>
        </div>
        <div className="space-y-2">
          {items.map(([key, descKey]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <code className="text-xs text-cyan-300">{key}</code>
              <span className="text-xs text-text-muted">{t(`keybindings.${descKey}`)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
