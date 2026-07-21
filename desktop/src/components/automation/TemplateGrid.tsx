import {
  Newspaper,
  Languages,
  FileText,
  GitPullRequest,
  CalendarCheck,
  GraduationCap,
  BarChart3,
  Shield,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { AUTOMATION_TEMPLATES } from "./templates";
import type { AutomationTemplate } from "./types";

const ICON_MAP: Record<string, LucideIcon> = {
  Newspaper,
  Languages,
  FileText,
  GitPullRequest,
  CalendarCheck,
  GraduationCap,
  BarChart3,
  Shield,
  Bell,
};

interface Props {
  onSelect: (template: AutomationTemplate) => void;
}

/** Template cards: hover / focus borders follow --theme-color-rgb. */
const TEMPLATE_CARD_BASE =
  "flex items-start gap-3 rounded-lg border bg-surface-card px-3 py-2.5 text-left transition-all outline-none hover:bg-surface-card-strong";
const TEMPLATE_CARD_IDLE =
  "border-border hover:border-[rgba(var(--theme-color-rgb,59,130,246),0.35)] focus-visible:border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";

export function TemplateGrid({ onSelect }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">
        从模板快速创建
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((tpl) => {
          const Icon = ICON_MAP[tpl.icon] ?? Bell;
          return (
            <button
              key={tpl.id}
              type="button"
              className={`${TEMPLATE_CARD_BASE} ${TEMPLATE_CARD_IDLE}`}
              onClick={() => onSelect(tpl)}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-panel">
                <Icon className="h-4 w-4 text-text-subtle" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-strong">{tpl.name}</div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                  {tpl.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
