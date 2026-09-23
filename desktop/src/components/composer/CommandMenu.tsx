import { useTranslation } from "react-i18next";
import type { VisibleCommand } from "../../services/commandsApi";
import { filterCommands } from "../../utils/command-send";

type Props = {
  items: VisibleCommand[];
  query: string;
  canPin: boolean;
  onSelect: (item: VisibleCommand) => void;
  onPin?: (item: VisibleCommand) => void;
};

export function CommandMenu({ items, query, canPin, onSelect, onPin }: Props) {
  const { t } = useTranslation("chat");
  const shown = filterCommands(items, query);
  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border bg-surface-popover shadow-lg">
      <div className="border-b border-border px-3 py-1.5 text-[11px] text-text-faint">
        {t("composer.commands.menuTitle", { count: shown.length })}
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {shown.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-faint">{t("composer.commands.empty")}</div>
        ) : (
          shown.map((item) => (
            <div key={`${item.scope}-${item.name}`} className="flex items-center gap-2 px-2 py-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                onClick={() => onSelect(item)}
              >
                <span className="shrink-0 font-mono text-[12px] text-text-strong">/{item.name}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-faint">{item.description}</span>
                <span className="shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
                  {t(`composer.commands.scope.${item.scope}`)}
                </span>
              </button>
              {canPin && item.scope !== "builtin" && item.scope !== "session" && onPin ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
                  onClick={() => onPin(item)}
                >
                  {t("composer.commands.pin")}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
